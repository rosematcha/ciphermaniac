/**
 * tests/utils/tierListFormats.test.ts
 * The Tier List Maker's format catalog, and the committed snapshot behind it.
 *
 * The snapshot is scraped and committed rather than fetched, so nothing at
 * runtime can tell us it went wrong — a scrape that lost a format, dropped an
 * archetype's sprites, or wrote shares as fractions would ship a quietly
 * broken picker. These are the assertions that catch that at build time.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  fetchFormatArchetypes,
  FORMAT_SPRITE_SLUGS,
  STANDARD_FORMAT_ID,
  TIER_FORMATS,
  tierFormat
} from '../../src/lib/data/formats';
import snapshot from '../../src/data/format-archetypes.json';
import icons from '../../src/data/archetype-icons.json';
import setCatalog from '../../.github/scripts/data/set-catalog.json';
import { hasPtcgioImages } from '../../src/utils/ptcgio';

const scraped = snapshot.formats;

test('the catalog leads with Standard', () => {
  assert.equal(TIER_FORMATS[0]?.id, STANDARD_FORMAT_ID);
});

test('every scraped format reaches the catalog', () => {
  assert.deepEqual(
    TIER_FORMATS.map(format => format.id),
    [STANDARD_FORMAT_ID, ...scraped.map(format => format.id)]
  );
});

test('format ids are unique', () => {
  const ids = TIER_FORMATS.map(format => format.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('both groups are populated, so neither optgroup renders empty', () => {
  for (const group of ['current', 'past'] as const) {
    assert.ok(
      TIER_FORMATS.some(format => format.group === group),
      `no ${group} formats`
    );
  }
});

test('every format claims card previews, because every one of them has art', () => {
  assert.deepEqual(
    TIER_FORMATS.filter(format => format.previews).map(format => format.id),
    TIER_FORMATS.map(format => format.id)
  );
});

test('an unknown id resolves to Standard rather than to nothing', () => {
  assert.equal(tierFormat('2005-worlds').id, STANDARD_FORMAT_ID);
  assert.equal(tierFormat(undefined).id, STANDARD_FORMAT_ID);
});

test('a known id resolves to itself', () => {
  for (const format of TIER_FORMATS) {
    assert.equal(tierFormat(format.id).id, format.id);
  }
});

test('scraped archetypes map onto the index shape the board renders', async () => {
  const entries = await fetchFormatArchetypes('ex');
  assert.ok(entries.length > 0);
  for (const entry of entries) {
    assert.equal(entry.label, entry.name);
    // No report stands behind a scraped format, so the count is honestly null
    // rather than zero-filled. The cards are real: they come off the format's
    // own decklists.
    assert.equal(entry.deckCount, null);
    assert.ok(entry.thumbnails.length > 0, `${entry.name} has no card art`);
    assert.ok((entry.icons?.length ?? 0) > 0, `${entry.name} has no sprite`);
  }
});

test('archetypes arrive in descending play order', async () => {
  for (const format of scraped) {
    const shares = (await fetchFormatArchetypes(format.id)).map(entry => entry.percent ?? 0);
    assert.deepEqual(
      shares,
      [...shares].sort((a, b) => b - a),
      format.id
    );
  }
});

/**
 * A rank-cut format records the rank it stopped at; a floor-cut one does not,
 * and the top-level `shareFloor` is what bounds it. Reading the cut off the
 * entry rather than off a list of ids here keeps this honest when a format
 * changes source.
 */
const rankCut = (format: unknown): boolean => typeof (format as { top?: unknown }).top === 'number';

test('shares are percentages, not fractions', () => {
  for (const format of scraped) {
    for (const archetype of format.archetypes) {
      assert.ok(
        archetype.share > 0 && archetype.share <= 100,
        `${format.id}/${archetype.name} share ${archetype.share}`
      );
    }
  }
});

test('a floor-cut format holds to its floor', () => {
  for (const format of scraped.filter(entry => !rankCut(entry))) {
    for (const archetype of format.archetypes) {
      assert.ok(archetype.share > snapshot.shareFloor, `${format.id}/${archetype.name} share ${archetype.share}`);
    }
  }
});

test('a rank-cut format holds to its rank', () => {
  const ranked = scraped.filter(rankCut);
  // EFG is the one today. If it ever becomes none, this file has stopped
  // covering the source that needs it most.
  assert.ok(ranked.length > 0, 'no rank-cut formats to check');
  for (const format of ranked) {
    assert.equal(format.archetypes.length, (format as unknown as { top: number }).top, format.id);
  }
});

test('the residual Other bucket never becomes an archetype', () => {
  for (const format of scraped) {
    assert.ok(!format.archetypes.some(archetype => archetype.name === 'Other'), format.id);
  }
});

test('no format is empty, which would drop it out of the picker', () => {
  for (const format of scraped) {
    assert.ok(format.archetypes.length > 0, format.id);
  }
});

test('names are unique within a format, since the board keys tiles by name', () => {
  for (const format of scraped) {
    const names = format.archetypes.map(archetype => archetype.name);
    assert.equal(new Set(names).size, names.length, format.id);
  }
});

test('at most two sprites per archetype, which is all a tile draws', () => {
  for (const format of scraped) {
    for (const archetype of format.archetypes) {
      assert.ok(archetype.icons.length <= 2, `${format.id}/${archetype.name}`);
    }
  }
});

test('the exported sprite list covers every slug the snapshot uses', () => {
  const used = new Set(scraped.flatMap(format => format.archetypes.flatMap(archetype => archetype.icons)));
  const offered = new Set(FORMAT_SPRITE_SLUGS);
  for (const slug of used) {
    assert.ok(offered.has(slug), `${slug} missing from FORMAT_SPRITE_SLUGS`);
  }
  assert.equal(offered.size, used.size);
});

test('the sprite list reaches past what Standard alone covers', () => {
  // The point of exporting it: past formats bring in Pokémon that have never
  // been Standard-legal here, and the mirror has to know about them.
  const standard = new Set(Object.values(icons as Record<string, string[]>).flat());
  assert.ok(FORMAT_SPRITE_SLUGS.some(slug => !standard.has(slug)));
});

test('at most two cards per archetype, which is what Standard ships', () => {
  for (const format of scraped) {
    for (const archetype of format.archetypes) {
      assert.ok((archetype.cards?.length ?? 0) <= 2, `${format.id}/${archetype.name}`);
    }
  }
});

test('card refs are SET/NNN, the form the image layer takes', () => {
  for (const format of scraped) {
    for (const archetype of format.archetypes) {
      for (const card of archetype.cards ?? []) {
        assert.match(card, /^[A-Z0-9]{2,8}\/(?:\d{3}[A-Z]*|[A-Z]{1,4}\d+)$/, `${format.id}/${archetype.name}`);
      }
    }
  }
});

/**
 * The one failure this file exists to catch that no runtime check would: a
 * scrape reaching back into an era whose scans Limitless's CDN does not carry.
 * Those sets have to be mapped to pokemontcg.io by hand, and an unmapped one
 * ships a whole format of blank tiles.
 */
test('every set the snapshot names is one the image layer can serve', () => {
  const catalog = setCatalog.sets.map(entry => entry.code);
  const limitlessCdnFrom = catalog.indexOf('HS');
  assert.ok(limitlessCdnFrom > 0, 'HS missing from the set catalog');
  // The catalog runs newest-first, so the CDN's era is everything before HS.
  const onLimitlessCdn = new Set(catalog.slice(0, limitlessCdnFrom + 1));
  for (const format of scraped) {
    for (const archetype of format.archetypes) {
      for (const card of archetype.cards ?? []) {
        const set = card.split('/')[0]!;
        assert.ok(
          hasPtcgioImages(set) || onLimitlessCdn.has(set),
          `${format.id}/${archetype.name}: ${set} has no image source`
        );
      }
    }
  }
});
