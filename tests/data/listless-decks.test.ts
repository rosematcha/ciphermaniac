/**
 * D13, extended to archetype reports: a standings entry with no published
 * decklist is a real deck in the meta but can never contain a card, so it must
 * not sit in the denominator for card inclusion.
 *
 * The bug this pins: one listless deck in Dragapult Blaziken capped every card
 * in the archetype at 777/778, so Blaziken ex read 99.9% of its own lists.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { generateReportFromDecks, listedDeckCount } from '../../shared/data/reports/cardReport.ts';
import { generateReportForFilters } from '../../shared/clientSideFiltering.ts';
import { buildArchetypeReports } from '../../shared/data/archetypes/build.ts';
import { onlineArchetypeOptions } from '../../shared/data/reports/onlineArtifacts.ts';

describe('listedDeckCount', () => {
  it('counts only decks carrying at least one card', () => {
    assert.equal(
      listedDeckCount([
        { cards: [{ name: 'Blaziken ex', count: 2 }] },
        { cards: [] },
        { cards: undefined },
        {},
        { cards: [{ name: 'Dragapult ex', count: 2 }] }
      ]),
      2
    );
  });

  it('asks only whether a decklist exists, not what the copy counts are', () => {
    // The predicate has to hold for every aggregator that divides by it, and
    // aggregateDecks counts a zero-copy row as present.
    assert.equal(listedDeckCount([{ cards: [{ name: 'Ghost', count: 0 }] }]), 1);
  });

  it('is zero for an empty or non-array deck list', () => {
    assert.equal(listedDeckCount([]), 0);
    assert.equal(listedDeckCount(undefined as never), 0);
  });
});

/** Two full lists plus one standings entry whose decklist was never published. */
const DECKS = [
  {
    archetype: 'Dragapult Blaziken',
    cards: [
      { name: 'Blaziken ex', set: 'JTG', number: '024', count: 2 },
      { name: 'Torchic', set: 'DRI', number: '040', count: 2 }
    ]
  },
  {
    archetype: 'Dragapult Blaziken',
    cards: [
      { name: 'Blaziken ex', set: 'JTG', number: '024', count: 2 },
      { name: 'Torchic', set: 'DRI', number: '040', count: 2 }
    ]
  },
  { archetype: 'Dragapult Blaziken', cards: [] }
];

describe('archetype reports exclude listless decks from the denominator', () => {
  const built = buildArchetypeReports(DECKS, null, onlineArchetypeOptions({}, null, null));
  const file = built.files.find(f => f.base.toLowerCase().includes('dragapult'))!;

  it('divides card inclusion by the decks that carry a list', () => {
    assert.equal(file.data.deckTotal, 2);
    const blaziken = file.data.items.find(i => i.name === 'Blaziken ex')!;
    assert.equal(blaziken.found, 2);
    assert.equal(blaziken.total, 2);
    // The point of the fix: a card in every published list reads 100%, not 66.7%.
    assert.equal(blaziken.pct, 100);
  });

  it('keeps every card at or below the report total', () => {
    for (const item of file.data.items) {
      assert.ok(item.found <= file.data.deckTotal, `${item.name}: ${item.found} > ${file.data.deckTotal}`);
      assert.ok(item.pct <= 100, `${item.name}: pct ${item.pct} > 100`);
    }
  });

  it('still counts the listless deck toward the archetype meta share', () => {
    // The entry has a placement and an archetype — it belongs in the meta even
    // though it contributes no card, so deckCount and the report total differ.
    assert.equal(file.deckCount, 3);
    const entry = built.index.find(e => e.name === file.base || e.label === file.displayName)!;
    assert.equal(entry.deckCount, 3);
  });

  it('leaves a report with no listless decks untouched', () => {
    const clean = buildArchetypeReports(DECKS.slice(0, 2), null, onlineArchetypeOptions({}, null, null));
    const cleanFile = clean.files.find(f => f.base.toLowerCase().includes('dragapult'))!;
    assert.equal(cleanFile.data.deckTotal, 2);
    assert.equal(cleanFile.deckCount, 2);
  });
});

describe('master reports exclude listless decks from the denominator', () => {
  it('reads 100% for a card in every published list', () => {
    const master = generateReportFromDecks(DECKS, listedDeckCount(DECKS), null);
    assert.equal(master.deckTotal, 2);
    assert.equal(master.items.find(i => i.name === 'Blaziken ex')!.pct, 100);
  });
});

describe('the filters panel excludes listless decks from the denominator', () => {
  it('reads 100% for a card in every published list of the filtered set', () => {
    const report = generateReportForFilters(
      DECKS.map((deck, i) => ({ ...deck, id: `d${i}` })) as never,
      'Dragapult Blaziken',
      []
    );
    assert.equal(report.deckTotal, 2);
    assert.equal(report.items.find(i => i.name === 'Blaziken ex')!.pct, 100);
  });
});
