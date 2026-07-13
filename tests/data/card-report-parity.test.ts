/**
 * tests/data/card-report-parity.test.ts
 *
 * Migration parity for the card-report builder consolidated into
 * `shared/data/reports/cardReport.ts` (DB-MASTER-PLAN Phase 2, slice 3).
 *
 * The OLD path is pinned by copying the pre-move `reportBuilder.ts` algorithm
 * verbatim into `legacyGenerateReportFromDecks` below (found-only sort, ties left
 * in first-seen deck order, `sanitizeForPath` on the name). We build reports from
 * the Phase 1 normalized fixtures and from hand-built decks through both the OLD
 * reference and the NEW builder and assert they are identical EXCEPT for the
 * approved tie-breaker ordering (decision D9): equal-`found` items are now name-
 * then-uid ordered and therefore input-order-independent.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { generateReportFromDecks } from '../../functions/lib/data/reportBuilder.js';
import type { CardEntry, DeckEntry, ReportItem } from '../../shared/data/reports/cardReport';
import {
  canonicalizeVariant,
  getCanonicalCardFromData,
  type SynonymDatabase
} from '../../shared/data/cardIdentity';
import {
  calculatePercentage,
  composeCategoryPath,
  createDistributionFromCounts
} from '../../shared/reportUtils';
import { sanitizeForPath } from '../../shared/cardUtils';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(HERE, '..', 'fixtures', 'data-pipeline');

// ---------------------------------------------------------------------------
// OLD path — verbatim copy of the pre-move reportBuilder.ts algorithm.
// The ONLY intended divergence from the NEW builder is ordering: this sorts by
// found (deck count) descending and leaves ties in first-seen key order.
// ---------------------------------------------------------------------------
function legacyGenerateReportFromDecks(
  deckList: DeckEntry[],
  deckTotal: number,
  synonymDb: SynonymDatabase | null
): { deckTotal: number; items: ReportItem[] } {
  const cardData = new Map<string, number[]>();
  const nameCasing = new Map<string, string>();
  const uidMeta = new Map<string, Record<string, unknown>>();
  const uidCategory = new Map<string, Record<string, unknown>>();

  const decks = Array.isArray(deckList) ? deckList : [];

  for (const deck of decks) {
    const perDeckCounts = new Map<string, number>();
    const perDeckMeta = new Map<string, Record<string, unknown>>();
    const cards = Array.isArray(deck?.cards) ? deck.cards : [];

    for (const card of cards) {
      const count = Number(card?.count) || 0;
      if (!count) {
        continue;
      }
      const name = card?.name || 'Unknown Card';
      const category = card?.category || null;
      const trainerType = card?.trainerType || null;
      const energyType = card?.energyType || null;
      const aceSpec = Boolean(card?.aceSpec);
      const regulationMark = card?.regulationMark || null;

      const [canonSet, canonNumber] = canonicalizeVariant(card?.set, card?.number);
      let uid = canonSet && canonNumber ? `${name}::${canonSet}::${canonNumber}` : name;
      if (synonymDb) {
        uid = getCanonicalCardFromData(synonymDb, uid);
      }

      perDeckCounts.set(uid, (perDeckCounts.get(uid) || 0) + count);
      perDeckMeta.set(uid, {
        set: canonSet || undefined,
        number: canonNumber || undefined,
        category: category || undefined,
        trainerType: trainerType || undefined,
        energyType: energyType || undefined,
        aceSpec: aceSpec || undefined,
        regulationMark: regulationMark || undefined
      });

      if (!nameCasing.has(uid)) {
        nameCasing.set(uid, name);
      }
      if ((category || trainerType || energyType || aceSpec || regulationMark) && !uidCategory.has(uid)) {
        uidCategory.set(uid, {
          category: category || undefined,
          trainerType: trainerType || undefined,
          energyType: energyType || undefined,
          aceSpec: aceSpec || undefined,
          regulationMark: regulationMark || undefined
        });
      }
    }

    perDeckCounts.forEach((totalCopies, uid) => {
      if (!cardData.has(uid)) {
        cardData.set(uid, []);
      }
      cardData.get(uid)!.push(totalCopies);
      if (!uidMeta.has(uid)) {
        uidMeta.set(uid, perDeckMeta.get(uid)!);
      }
    });
  }

  const sortedKeys = Array.from(cardData.keys()).sort(
    (first, second) => cardData.get(second)!.length - cardData.get(first)!.length
  );

  const items = sortedKeys.map((uid, index) => {
    const countsList = cardData.get(uid) || [];
    const foundCount = countsList.length;
    const rawName = nameCasing.get(uid) || uid;
    const safeName = sanitizeForPath(rawName);
    const item: ReportItem = {
      rank: index + 1,
      name: safeName,
      found: foundCount,
      total: deckTotal,
      pct: calculatePercentage(foundCount, deckTotal),
      dist: createDistributionFromCounts(countsList, foundCount)
    };

    if (uid.includes('::')) {
      const [, canonicalSet, canonicalNumber] = uid.split('::');
      if (canonicalSet) {
        item.set = canonicalSet;
      }
      if (canonicalNumber) {
        item.number = canonicalNumber;
      }
      item.uid = uid;
    }

    const categoryInfo = uidCategory.get(uid) || uidMeta.get(uid);
    if (categoryInfo) {
      if (categoryInfo.trainerType) {
        item.trainerType = categoryInfo.trainerType as string;
      }
      if (categoryInfo.energyType) {
        item.energyType = categoryInfo.energyType as string;
      }
      if (categoryInfo.aceSpec) {
        item.aceSpec = true;
      }
      if (categoryInfo.regulationMark) {
        item.regulationMark = categoryInfo.regulationMark as string;
      }
      const categorySlug = composeCategoryPath(
        categoryInfo.category as string | undefined,
        categoryInfo.trainerType as string | undefined,
        categoryInfo.energyType as string | undefined,
        { aceSpec: Boolean(categoryInfo.aceSpec) }
      );
      if (categorySlug) {
        item.category = categorySlug;
      } else if (categoryInfo.category) {
        item.category = categoryInfo.category as string;
      }
    }

    return item;
  });

  return { deckTotal, items };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip volatile `rank` and sort items by uid/name so content can be compared
 *  independent of ordering. */
function contentKey(items: ReportItem[]): Array<Omit<ReportItem, 'rank'>> {
  return items
    .map(({ rank: _rank, ...rest }) => rest)
    .sort((a, b) => (a.uid || a.name).localeCompare(b.uid || b.name));
}

/** Assert items obey the D9 total order: pct desc, found desc, name asc, uid asc. */
function assertD9Ordered(items: ReportItem[]): void {
  for (let i = 1; i < items.length; i += 1) {
    const prev = items[i - 1];
    const cur = items[i];
    if (prev.pct !== cur.pct) {
      assert.ok(prev.pct > cur.pct, `pct must be non-increasing at index ${i}`);
      continue;
    }
    if (prev.found !== cur.found) {
      assert.ok(prev.found > cur.found, `found must be non-increasing within equal pct at ${i}`);
      continue;
    }
    const nameCmp = prev.name.localeCompare(cur.name);
    if (nameCmp !== 0) {
      assert.ok(nameCmp < 0, `name must be ascending within equal found at ${i}`);
      continue;
    }
    assert.ok((prev.uid || '').localeCompare(cur.uid || '') <= 0, `uid must be ascending within equal name at ${i}`);
  }
  // Ranks are dense and 1-based.
  items.forEach((item, index) => assert.strictEqual(item.rank, index + 1));
}

/** Adapt a normalized-fixture deck to the legacy card-report input shape. */
interface FixtureCard {
  canonical?: { name?: string; set?: string | null; number?: string | null };
  count?: number;
  category?: string;
  trainerType?: string;
  energyType?: string;
  aceSpec?: boolean;
  regulationMark?: string;
}
function toLegacyDeck(deck: { cards?: FixtureCard[] }): DeckEntry {
  const cards: CardEntry[] = (deck.cards || []).map(card => ({
    name: card.canonical?.name,
    set: card.canonical?.set ?? undefined,
    number: card.canonical?.number ?? undefined,
    count: card.count,
    category: card.category,
    trainerType: card.trainerType,
    energyType: card.energyType,
    aceSpec: card.aceSpec,
    regulationMark: card.regulationMark
  }));
  return { cards };
}

function loadFixtureDecks(name: string): DeckEntry[] {
  const raw = JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8')) as { decks?: Array<{ cards?: FixtureCard[] }> };
  return (raw.decks || []).map(toLegacyDeck);
}

// ---------------------------------------------------------------------------
// Fixture parity: OLD and NEW agree on content; NEW is D9-ordered.
// ---------------------------------------------------------------------------
for (const fixture of ['labs-event.json', 'online-window.json']) {
  test(`fixture ${fixture}: OLD and NEW produce identical content; NEW is D9-ordered`, () => {
    const decks = loadFixtureDecks(fixture);
    const oldReport = legacyGenerateReportFromDecks(decks, decks.length, null);
    const newReport = generateReportFromDecks(decks, decks.length, null);

    assert.strictEqual(newReport.deckTotal, oldReport.deckTotal);
    assert.strictEqual(newReport.items.length, oldReport.items.length);
    // Identical rows (every field except rank) — order is the only allowed diff.
    assert.deepStrictEqual(contentKey(newReport.items), contentKey(oldReport.items));
    assertD9Ordered(newReport.items);
  });
}

// ---------------------------------------------------------------------------
// Hand-built decks: content parity, and NEW reorders equal-found ties by name.
// ---------------------------------------------------------------------------
function card(name: string, count: number, set?: string, number?: string, category?: string): CardEntry {
  const entry: CardEntry = { name, count };
  if (set !== undefined) {
    entry.set = set;
  }
  if (number !== undefined) {
    entry.number = number;
  }
  if (category !== undefined) {
    entry.category = category;
  }
  return entry;
}

test('hand decks: content identical, NEW breaks equal-found ties by name (OLD did not)', () => {
  // Zzz and Aaa each appear in exactly 2 of 4 decks -> equal found (2), equal
  // pct (50). Zzz is seen first, so the OLD found-only sort keeps Zzz ahead.
  const decks: DeckEntry[] = [
    { cards: [card('Zzz', 1), card('Mmm', 1)] },
    { cards: [card('Zzz', 2), card('Aaa', 1)] },
    { cards: [card('Aaa', 2), card('Mmm', 1)] },
    { cards: [card('Mmm', 1)] }
  ];

  const oldReport = legacyGenerateReportFromDecks(decks, decks.length, null);
  const newReport = generateReportFromDecks(decks, decks.length, null);

  // Same content regardless of order.
  assert.deepStrictEqual(contentKey(newReport.items), contentKey(oldReport.items));
  assertD9Ordered(newReport.items);

  // Mmm is found in 3 decks -> always first. Zzz/Aaa tie at found 2.
  assert.strictEqual(newReport.items[0].name, 'Mmm');
  // OLD kept first-seen order for the tie (Zzz before Aaa)...
  const oldTie = oldReport.items.slice(1).map(i => i.name);
  assert.deepStrictEqual(oldTie, ['Zzz', 'Aaa']);
  // ...NEW orders the tie by name (Aaa before Zzz).
  const newTie = newReport.items.slice(1).map(i => i.name);
  assert.deepStrictEqual(newTie, ['Aaa', 'Zzz']);
});

test('NEW ordering of equal-found ties is input-order-independent', () => {
  const forward: DeckEntry[] = [
    { cards: [card('Zzz', 1)] },
    { cards: [card('Zzz', 1)] },
    { cards: [card('Aaa', 1)] },
    { cards: [card('Aaa', 1)] }
  ];
  const reversed: DeckEntry[] = [...forward].reverse();

  const a = generateReportFromDecks(forward, forward.length, null);
  const b = generateReportFromDecks(reversed, reversed.length, null);

  // Byte-identical output whichever order the decks arrive in.
  assert.deepStrictEqual(a.items, b.items);
  assert.deepStrictEqual(
    a.items.map(i => i.name),
    ['Aaa', 'Zzz']
  );
});

test('NEW ordering is permutation-invariant across many deck orderings', () => {
  const base: DeckEntry[] = [
    { cards: [card('Iono', 3, 'PAL', '185', 'trainer'), card('Pikachu', 2, 'SVI', '1', 'pokemon')] },
    { cards: [card('Pikachu', 2, 'SVI', '001', 'pokemon'), card('Boss', 1, 'MEG', '114', 'trainer')] },
    { cards: [card('Iono', 4, 'PAL', '185', 'trainer'), card('Charizard', 1, 'SWSH', '12', 'pokemon')] },
    { cards: [card('Boss', 1, 'MEG', '114', 'trainer'), card('Pikachu', 1, 'SVI', '1', 'pokemon')] }
  ];

  const reference = generateReportFromDecks(base, base.length, null);
  assertD9Ordered(reference.items);

  // Every rotation of the deck order must yield byte-identical output.
  for (let shift = 1; shift < base.length; shift += 1) {
    const rotated = [...base.slice(shift), ...base.slice(0, shift)];
    const report = generateReportFromDecks(rotated, rotated.length, null);
    assert.deepStrictEqual(report.items, reference.items, `rotation by ${shift} must match reference`);
  }
});
