/**
 * tests/data/card-usage-conversion-parity.test.ts
 *
 * Migration parity for the LEGACY-shape card-usage and conversion index builders
 * consolidated into `shared/data/reports/cardUsage.ts` and
 * `shared/data/reports/conversion.ts` (DB-MASTER-PLAN Phase 2, slice 4).
 *
 * cardUsage — the live producer (run-online-meta.ts) now imports the shared
 * builder directly, so these tests pin the builder's semantics over
 * per-archetype reports built from the Phase 1 normalized fixtures plus
 * synonym-edge decks (two printings in one deck; a synonym canonical rewrite).
 *
 * conversion — the only current producer is Python's
 * `download-tournament.py::build_conversion_index`, which cannot run in the JS
 * test suite. We hand-port its semantics into expected outputs covering per-deck
 * Day 2 dedup, canonical merge of two printings, missing decklists, the bare-name
 * skip guard, and the `day2Total === 0` (no conversion emitted) case.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  type ArchetypeUsageSource,
  buildCardUsageIndex as buildCardUsageIndexShared
} from '../../shared/data/reports/cardUsage';
import { buildConversionIndex } from '../../shared/data/reports/conversion';
import { type DeckEntry, generateReportFromDecks } from '../../shared/data/reports/cardReport';
import type { SynonymDatabase } from '../../shared/data/cardIdentity';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(HERE, '..', 'fixtures', 'data-pipeline');

// ---------------------------------------------------------------------------
// cardUsage: the shared TS builder over the fixture corpus.
// ---------------------------------------------------------------------------

/** A normalized Phase 1 deck card (only the fields we flatten are typed). */
interface NormalizedCard {
  canonical: { name: string; set: string | null; number: string | null };
  count: number;
}
interface NormalizedDeck {
  archetype: { slug: string };
  cards: NormalizedCard[];
}
interface NormalizedEvent {
  decks: NormalizedDeck[];
}

function loadEvent(name: string): NormalizedEvent {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8')) as NormalizedEvent;
}

/** Flatten a normalized deck to the raw-deck shape generateReportFromDecks reads. */
function toRawDeck(deck: NormalizedDeck): DeckEntry {
  return {
    cards: deck.cards.map(card => ({
      name: card.canonical.name,
      set: card.canonical.set ?? undefined,
      number: card.canonical.number ?? undefined,
      count: card.count
    }))
  };
}

/** Build per-archetype `{ base, data }` report files from normalized decks. */
function archetypeFilesFromEvent(event: NormalizedEvent, synonymDb: SynonymDatabase | null): ArchetypeUsageSource[] {
  const bySlug = new Map<string, DeckEntry[]>();
  for (const deck of event.decks) {
    const { slug } = deck.archetype;
    const group = bySlug.get(slug);
    if (group) {
      group.push(toRawDeck(deck));
    } else {
      bySlug.set(slug, [toRawDeck(deck)]);
    }
  }
  return Array.from(bySlug.entries()).map(([base, decks]) => ({
    base,
    data: generateReportFromDecks(decks, decks.length, synonymDb)
  }));
}

test('cardUsage: builds a non-trivial index over the fixtures', () => {
  const files: ArchetypeUsageSource[] = [
    ...archetypeFilesFromEvent(loadEvent('labs-event.json'), null),
    ...archetypeFilesFromEvent(loadEvent('online-window.json'), null)
  ];

  const shared = buildCardUsageIndexShared(files);
  // The corpus is non-trivial: several UIDs, each with usage rows.
  assert.ok(Object.keys(shared.usage).length > 3);
});

test('cardUsage: synonym-edge reports (two printings + canonical rewrite)', () => {
  // Iono PAF 237 is a variant printing of the canonical Iono PAL 185.
  const synonymDb: SynonymDatabase = {
    synonyms: { 'Iono::PAF::237': 'Iono::PAL::185' },
    canonicals: {}
  };

  // Archetype A: one deck lists BOTH printings of Iono — they collapse to a
  // single canonical row (found counted once per deck, never pct > 100).
  const archetypeA: DeckEntry[] = [
    {
      cards: [
        { name: 'Iono', set: 'PAF', number: '237', count: 2 },
        { name: 'Iono', set: 'PAL', number: '185', count: 2 },
        { name: 'Charizard ex', set: 'OBF', number: '125', count: 3 }
      ]
    }
  ];
  // Archetype B: a deck listing only the variant printing, which the synonym DB
  // rewrites to the canonical UID — the usage key must be the canonical one.
  const archetypeB: DeckEntry[] = [{ cards: [{ name: 'Iono', set: 'PAF', number: '237', count: 1 }] }];

  const files: ArchetypeUsageSource[] = [
    { base: 'archetype_a', data: generateReportFromDecks(archetypeA, archetypeA.length, synonymDb) },
    { base: 'archetype_b', data: generateReportFromDecks(archetypeB, archetypeB.length, synonymDb) }
  ];

  const shared = buildCardUsageIndexShared(files);

  // Both printings resolved to the one canonical key; A counts Iono once.
  const ionoRows = shared.usage['Iono::PAL::185'];
  assert.ok(ionoRows, 'canonical Iono UID present');
  assert.strictEqual(shared.usage['Iono::PAF::237'], undefined, 'variant UID must not leak into the index');
  const rowA = ionoRows.find(r => r.slug === 'archetype_a');
  assert.ok(rowA);
  assert.strictEqual(rowA.found, 1);
  assert.strictEqual(rowA.pct, 100);
});

// ---------------------------------------------------------------------------
// conversion parity: shared TS builder vs hand-ported Python semantics.
// ---------------------------------------------------------------------------

const CONV_SYNONYMS: SynonymDatabase = {
  synonyms: { 'Iono::PAF::237': 'Iono::PAL::185' },
  canonicals: {}
};

test('conversion: Day 2 dedup, canonical merge, and missing decklists', () => {
  const decks = [
    // Day 2 deck listing both printings of Iono (dedup to one canonical UID).
    {
      madePhase2: true,
      cards: [
        { name: 'Iono', set: 'PAF', number: '237' },
        { name: 'Iono', set: 'PAL', number: '185' },
        { name: 'Charizard ex', set: 'OBF', number: '125' }
      ]
    },
    // Day 2 deck; the basic energy (no set) is skipped by the guard.
    {
      madePhase2: true,
      cards: [
        { name: 'Iono', set: 'PAL', number: '185' },
        { name: 'Basic Fire Energy', set: null, number: null }
      ]
    },
    // Day 1 only.
    { madePhase2: false, cards: [{ name: 'Charizard ex', set: 'OBF', number: '125' }] },
    // Missing decklist — counts toward day1Total but contributes no cards.
    { madePhase2: false, cards: [] }
  ];

  const index = buildConversionIndex(decks, CONV_SYNONYMS);

  // Hand-ported expected output, keys in first-seen (deck then card) order.
  const expected = {
    day1Total: 4,
    day2Total: 2,
    cards: {
      'Iono::PAL::185': { day1: 2, day2: 2 },
      'Charizard ex::OBF::125': { day1: 2, day2: 1 }
    }
  };

  assert.deepStrictEqual(index, expected);
  // Pin key order (first-seen), matching Python dict insertion.
  assert.strictEqual(JSON.stringify(index), JSON.stringify(expected));
  // Invariant: day2 <= day1 for every card.
  for (const counts of Object.values(index!.cards)) {
    assert.ok(counts.day2 <= counts.day1);
  }
});

test('conversion: without a synonym DB the two printings stay distinct', () => {
  const decks = [
    {
      madePhase2: true,
      cards: [
        { name: 'Iono', set: 'PAF', number: '237' },
        { name: 'Iono', set: 'PAL', number: '185' }
      ]
    }
  ];

  const index = buildConversionIndex(decks, null);
  assert.deepStrictEqual(index, {
    day1Total: 1,
    day2Total: 1,
    cards: {
      'Iono::PAF::237': { day1: 1, day2: 1 },
      'Iono::PAL::185': { day1: 1, day2: 1 }
    }
  });
});

test('conversion: cards without a canonicalizable set+number are skipped', () => {
  const decks = [
    {
      madePhase2: true,
      cards: [
        { name: 'Charizard ex', set: 'OBF', number: '125' },
        { name: 'Bare Name', set: '', number: '' }, // no set -> skipped
        { name: 'Empty Number', set: 'XYZ', number: '' }, // empty number -> skipped
        { name: 'Null Number', set: 'XYZ', number: null } // null number -> skipped
      ]
    }
  ];

  const index = buildConversionIndex(decks, null);
  assert.deepStrictEqual(index, {
    day1Total: 1,
    day2Total: 1,
    cards: { 'Charizard ex::OBF::125': { day1: 1, day2: 1 } }
  });
});

test('conversion: returns null when no deck made Day 2', () => {
  const decks = [
    { madePhase2: false, cards: [{ name: 'Charizard ex', set: 'OBF', number: '125' }] },
    { madePhase2: false, cards: [{ name: 'Iono', set: 'PAL', number: '185' }] }
  ];
  assert.strictEqual(buildConversionIndex(decks, null), null);
});

test('conversion: returns null for empty or missing input', () => {
  assert.strictEqual(buildConversionIndex([], null), null);
  assert.strictEqual(buildConversionIndex(undefined, null), null);
  assert.strictEqual(buildConversionIndex(null, null), null);
});
