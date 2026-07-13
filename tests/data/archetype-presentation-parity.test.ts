/**
 * tests/data/archetype-presentation-parity.test.ts
 *
 * Migration parity for archetype identity/grouping/presentation consolidated
 * into `shared/data/archetypes/{identity,presentation,build}.ts`
 * (DB-MASTER-PLAN Phase 2, slice 5).
 *
 * Thumbnails + signature cards — the LIVE authority is the online pipeline in
 * `.github/scripts/run-online-meta.mjs`. We import its (export-plumbed)
 * internals and assert the shared presentation engine is byte-identical over
 * identical report inputs covering every inference stage, and that the shared
 * grouped builder reproduces the .mjs `buildArchetypeReports` output over the
 * Phase 1 fixtures plus synonym-edge decks. The production thumbnail override
 * config is empty (`{}`), so override fallbacks (a dead branch in the .mjs at
 * runtime) are pinned by direct tests of the shared engine against the
 * documented online semantics.
 *
 * Icons — the only implementation was Python
 * (`download-tournament.py::resolve_archetype_icons`), which cannot run in the
 * JS suite. Its semantics are hand-ported into expected outputs covering the
 * override cap, underscore/label reconciliation (including Python's
 * curly-quote handling), thumbnail-derived slugs with padding-insensitive id
 * matching, and species dedupe.
 *
 * The one approved divergence surfaced here is D9 report-item ordering: the
 * shared card report orders equal-`found` items name-then-uid while the .mjs
 * copy leaves ties in first-seen order, so per-archetype report items are
 * compared under a shared total order.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  buildArchetypeReports as buildArchetypeReportsMjs,
  buildCardMetaLookup as buildCardMetaLookupMjs,
  generateSignatureCards as generateSignatureCardsMjs,
  resolveArchetypeThumbnails as resolveArchetypeThumbnailsMjs
} from '../../.github/scripts/run-online-meta.mjs';
import {
  buildCardMetaLookup,
  buildMetaUsage,
  generateSignatureCards,
  type PresentationReport,
  resolveArchetypeIcons,
  resolveArchetypeThumbnails,
  slugifyPokemonIcon
} from '../../shared/data/archetypes/presentation';
import {
  type ArchetypeDeckInput,
  buildArchetypeReports,
  deriveArchetypeGrouping
} from '../../shared/data/archetypes/build';
import { generateReportFromDecks, type ReportItem } from '../../shared/data/reports/cardReport';
import type { SynonymDatabase } from '../../shared/data/cardIdentity';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(HERE, '..', 'fixtures', 'data-pipeline');

// ---------------------------------------------------------------------------
// Fixture + synonym-edge corpus
// ---------------------------------------------------------------------------

interface NormalizedCard {
  canonical: { name: string; set: string | null; number: string | null };
  count: number;
  category?: string;
  trainerType?: string;
  energyType?: string;
}
interface NormalizedDeck {
  archetype: { displayName: string };
  cards: NormalizedCard[];
}

function loadEventDecks(name: string): ArchetypeDeckInput[] {
  const event = JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8')) as { decks: NormalizedDeck[] };
  return event.decks.map(deck => ({
    archetype: deck.archetype.displayName,
    cards: deck.cards.map(card => ({
      name: card.canonical.name,
      set: card.canonical.set ?? undefined,
      number: card.canonical.number ?? undefined,
      count: card.count,
      ...(card.category !== undefined ? { category: card.category } : {}),
      ...(card.trainerType !== undefined ? { trainerType: card.trainerType } : {}),
      ...(card.energyType !== undefined ? { energyType: card.energyType } : {})
    }))
  }));
}

const SYNONYM_DB: SynonymDatabase = {
  synonyms: { 'Iono::PAF::237': 'Iono::PAL::185' },
  canonicals: {}
};

/** Synonym-edge decks: two printings in one deck; a canonical rewrite. */
const SYNONYM_EDGE_DECKS: ArchetypeDeckInput[] = [
  {
    archetype: 'Iono Control',
    cards: [
      { name: 'Iono', set: 'PAF', number: '237', count: 2, category: 'trainer', trainerType: 'supporter' },
      { name: 'Iono', set: 'PAL', number: '185', count: 2, category: 'trainer', trainerType: 'supporter' },
      { name: 'Snorlax', set: 'PGO', number: '055', count: 3, category: 'pokemon' }
    ]
  },
  {
    archetype: 'Iono Control',
    cards: [
      { name: 'Iono', set: 'PAF', number: '237', count: 4, category: 'trainer', trainerType: 'supporter' },
      { name: 'Snorlax', set: 'PGO', number: '055', count: 4, category: 'pokemon' },
      { name: 'Rotom V', set: 'CRZ', number: '045', count: 1, category: 'pokemon' }
    ]
  }
];

/** Stage-2 deck: both name tokens are descriptor tokens, so only the
 * ability/attack title match can pick a face. */
const FESTIVAL_DECKS: ArchetypeDeckInput[] = [
  {
    archetype: 'Festival Lead',
    cards: [
      { name: 'Dipplin', set: 'TWM', number: '018', count: 4, category: 'pokemon' },
      { name: 'Sinistcha ex', set: 'TWM', number: '023', count: 2, category: 'pokemon' },
      { name: 'Buddy-Buddy Poffin', set: 'TEF', number: '144', count: 4, category: 'trainer', trainerType: 'item' }
    ]
  }
];

const CARD_TYPES_DB = {
  'TWM::018': { abilities: ['Festival Lead'], attacks: ['Festival Grounds'] },
  'TWM::023': { abilities: [], attacks: ['Matcha Splash'] },
  'PGO::055': { abilities: ['Block'], attacks: ['Collapse'] }
};

function corpusDecks(): ArchetypeDeckInput[] {
  return [
    ...loadEventDecks('labs-event.json'),
    ...loadEventDecks('online-window.json'),
    ...SYNONYM_EDGE_DECKS,
    ...FESTIVAL_DECKS
  ];
}

/** D9 total order (pct desc, found desc, name, uid) applied to both sides so
 * the approved tie-order divergence doesn't fail the comparison. `rank` is
 * derived from position, so it is renumbered after the re-sort. */
function sortItemsD9(report: { deckTotal: number; items: ReportItem[] }) {
  return {
    deckTotal: report.deckTotal,
    items: [...report.items]
      .sort(
        (a, b) =>
          b.pct - a.pct ||
          b.found - a.found ||
          (a.name || '').localeCompare(b.name || '') ||
          (a.uid || '').localeCompare(b.uid || '')
      )
      .map((item, position) => ({ ...item, rank: position + 1 }))
  };
}

// ---------------------------------------------------------------------------
// Presentation parity vs the online .mjs over identical report inputs
// ---------------------------------------------------------------------------

interface MjsArchetypeFile {
  filename: string;
  base: string;
  displayName: string;
  deckCount: number;
  data: { deckTotal: number; items: ReportItem[] };
}
interface MjsBuildResult {
  minDecks: number;
  files: MjsArchetypeFile[];
  index: Array<Record<string, unknown>>;
  decksByArchetype: Map<string, unknown[]>;
}

/** Group the corpus with the .mjs grouping so both engines see the exact same
 * per-archetype report data (built by the .mjs's own report builder). */
function mjsGroupedReports(masterReport: PresentationReport | null, cardTypesDb: unknown): MjsBuildResult {
  return (buildArchetypeReportsMjs as (...args: unknown[]) => MjsBuildResult)(
    corpusDecks(),
    SYNONYM_DB,
    masterReport,
    cardTypesDb
  );
}

test('thumbnails: shared engine is byte-identical to run-online-meta.mjs per archetype (stages 1-3)', () => {
  const decks = corpusDecks();
  const masterReport = generateReportFromDecks(decks, decks.length, SYNONYM_DB);
  const metaUsageShared = buildMetaUsage(masterReport);
  const lookupShared = buildCardMetaLookup(CARD_TYPES_DB);
  const lookupMjs = (buildCardMetaLookupMjs as (db: unknown) => Map<string, unknown>)(CARD_TYPES_DB);
  assert.deepStrictEqual(lookupShared, lookupMjs, 'card-meta lookup parity');

  const { files } = mjsGroupedReports(masterReport, CARD_TYPES_DB);
  assert.ok(files.length >= 6, `expected a non-trivial corpus, got ${files.length} archetypes`);

  let inferred = 0;
  for (const file of files) {
    const shared = resolveArchetypeThumbnails(file.base, file.displayName, file.data, {
      config: {}, // live config is empty; the .mjs global is the same {}
      cardMetaLookup: lookupShared,
      metaUsage: metaUsageShared
    });
    const mjs = (resolveArchetypeThumbnailsMjs as (...args: unknown[]) => string[])(
      file.base,
      file.displayName,
      file.data,
      lookupMjs,
      buildMetaUsage(masterReport)
    );
    assert.deepStrictEqual(shared, mjs, `thumbnails diverged for ${file.displayName}`);
    assert.strictEqual(JSON.stringify(shared), JSON.stringify(mjs));
    if (shared.length) {
      inferred += 1;
    }
  }
  assert.ok(inferred >= 4, `expected most archetypes to infer thumbnails, got ${inferred}`);

  // Stage 2 specifically: "Festival Lead" is all descriptor tokens, so its
  // face must come from Dipplin's ability via the card-types lookup.
  const festival = files.find(file => file.displayName === 'Festival Lead');
  assert.ok(festival);
  const festivalThumbs = resolveArchetypeThumbnails(festival.base, festival.displayName, festival.data, {
    config: {},
    cardMetaLookup: lookupShared,
    metaUsage: metaUsageShared
  });
  assert.deepStrictEqual(festivalThumbs, ['TWM/018']);
});

test('signature cards: shared engine is byte-identical to run-online-meta.mjs per archetype', () => {
  const decks = corpusDecks();
  const masterReport = generateReportFromDecks(decks, decks.length, SYNONYM_DB);
  const lookup = buildCardMetaLookup(CARD_TYPES_DB);
  const metaUsage = buildMetaUsage(masterReport);
  const { files } = mjsGroupedReports(masterReport, CARD_TYPES_DB);

  let nonEmpty = 0;
  for (const file of files) {
    const thumbnails = resolveArchetypeThumbnails(file.base, file.displayName, file.data, {
      config: {},
      cardMetaLookup: lookup,
      metaUsage
    });
    const shared = generateSignatureCards(file.displayName, file.data, masterReport, thumbnails);
    const mjs = (generateSignatureCardsMjs as (...args: unknown[]) => unknown[])(
      file.displayName,
      file.data,
      masterReport,
      thumbnails
    );
    assert.deepStrictEqual(shared, mjs, `signature cards diverged for ${file.displayName}`);
    assert.strictEqual(JSON.stringify(shared), JSON.stringify(mjs));
    if (shared.length) {
      nonEmpty += 1;
    }
  }
  assert.ok(nonEmpty >= 2, `expected some archetypes to have signature cards, got ${nonEmpty}`);
});

test('build: shared online-profile builder matches run-online-meta.mjs buildArchetypeReports', () => {
  const decks = corpusDecks();
  const masterReport = generateReportFromDecks(decks, decks.length, SYNONYM_DB);

  const mjs = mjsGroupedReports(masterReport, CARD_TYPES_DB);
  const shared = buildArchetypeReports(decks, SYNONYM_DB, {
    nameCasing: 'preserve',
    minDecksFraction: 0.005,
    percentMode: 'fraction',
    sortMode: 'deckCount',
    thumbnailConfig: {},
    cardTypesDb: CARD_TYPES_DB,
    masterReport,
    includeSignatureCards: true
  });

  assert.strictEqual(shared.minDecks, mjs.minDecks);

  // Index parity: entries must be byte-identical (field order included) —
  // this covers grouping, casing preservation, ordering, fraction percent,
  // thumbnails, and signature cards end to end.
  assert.deepStrictEqual(shared.index, mjs.index);
  assert.strictEqual(JSON.stringify(shared.index), JSON.stringify(mjs.index));

  // Case-preserving grouping (D3 quirk): the fixture's case variants stay
  // separate groups, exactly as the online producer emits them today.
  const names = shared.index.map(entry => entry.name);
  assert.ok(names.includes('Gardevoir_ex') && names.includes('gardevoir_EX'), `got ${names.join(', ')}`);

  // File parity: same bases/labels/counts; report data equal under the shared
  // D9 total order (the .mjs sorts equal-found ties in first-seen order).
  assert.strictEqual(shared.files.length, mjs.files.length);
  mjs.files.forEach((mjsFile, position) => {
    const sharedFile = shared.files[position];
    assert.strictEqual(sharedFile.base, mjsFile.base);
    assert.strictEqual(sharedFile.displayName, mjsFile.displayName);
    assert.strictEqual(sharedFile.deckCount, mjsFile.deckCount);
    assert.deepStrictEqual(sortItemsD9(sharedFile.data), sortItemsD9(mjsFile.data));
  });

  // Deck maps carry the same groups.
  assert.deepStrictEqual([...shared.decksByBase.keys()], [...mjs.decksByArchetype.keys()]);
});

// ---------------------------------------------------------------------------
// Override fallbacks (dead branch in the live .mjs — its config is {}) pinned
// against the documented online semantics.
// ---------------------------------------------------------------------------

test('thumbnail overrides: direct hit returns the config entry whole (online semantics, uncapped)', () => {
  const config = { 'Ancient Box': ['TEF/109', 'TEF/078', 'PAR/080'] };
  const report = { items: [] };

  // Direct display-name hit; explicit entries are NOT capped at 2.
  assert.deepStrictEqual(resolveArchetypeThumbnails('Ancient_Box', 'Ancient Box', report, { config }), [
    'TEF/109',
    'TEF/078',
    'PAR/080'
  ]);
  // Underscored label reaches the same entry via the underscore→space attempt.
  assert.deepStrictEqual(resolveArchetypeThumbnails('Ancient_Box', 'Ancient_Box', report, { config }), [
    'TEF/109',
    'TEF/078',
    'PAR/080'
  ]);
  // Case/punctuation drift reconciles through label normalization.
  assert.deepStrictEqual(resolveArchetypeThumbnails('ancient_box', 'ANCIENT  BOX', report, { config }), [
    'TEF/109',
    'TEF/078',
    'PAR/080'
  ]);
  // No hit and no items -> empty.
  assert.deepStrictEqual(resolveArchetypeThumbnails('Other', 'Other', report, { config }), []);
});

test('thumbnail override reconciliation strips straight apostrophes only (online flavor)', () => {
  const config = { "N's Zoroark": ['SVI/999'] };
  // Straight-apostrophe drift matches...
  assert.deepStrictEqual(resolveArchetypeThumbnails('base', 'ns zoroark', { items: [] }, { config }), ['SVI/999']);
  // ...but a curly-quote label does NOT (the online char class covers U+0027
  // only) — it falls through to inference and returns empty here.
  assert.deepStrictEqual(resolveArchetypeThumbnails('base', 'N’s  Zoroark!', { items: [] }, { config }), []);
});

// ---------------------------------------------------------------------------
// Icons: shared engine vs hand-ported Python expectations
// ---------------------------------------------------------------------------

test('icons: override hits are capped at 2 and reconcile labels like Python', () => {
  const config = {
    'Ancient Box': ['roaring-moon', 'flutter-mane', 'koraidon'],
    "N's Zoroark": ['zoroark-hisui']
  };

  // Direct hit — Python caps overrides at AUTO_THUMB_MAX (unlike thumbnails).
  assert.deepStrictEqual(resolveArchetypeIcons('Ancient_Box', 'Ancient Box', [], null, config), [
    'roaring-moon',
    'flutter-mane'
  ]);
  // Underscore→space attempt.
  assert.deepStrictEqual(resolveArchetypeIcons('Ancient_Box', 'Ancient_Box', [], null, config), [
    'roaring-moon',
    'flutter-mane'
  ]);
  // Python's normalize_deck_label strips CURLY quotes too, so a curly-quote
  // producer label still reconciles to the straight-quote config key.
  assert.deepStrictEqual(resolveArchetypeIcons('Ns_Zoroark', 'N’s Zoroark', [], null, config), ['zoroark-hisui']);
});

test('icons: derived from thumbnail Pokémon with padding-insensitive ids and species dedupe', () => {
  const report = {
    items: [
      { name: 'Charizard ex', set: 'OBF', number: '125', pct: 100, category: 'pokemon' },
      { name: 'Ogerpon ex', set: 'TWM', number: '025', pct: 80, category: 'pokemon' },
      { name: 'Ogerpon ex', set: 'TWM', number: '111', pct: 60, category: 'pokemon' },
      { name: 'Rare Candy', set: 'SVI', number: '191', pct: 90, category: 'trainer' }
    ]
  };

  // Hand-ported from download-tournament.py::_derive_icons_from_thumbnails:
  // "OBF/125" -> "Charizard ex" -> slug "charizard".
  assert.deepStrictEqual(resolveArchetypeIcons('base', 'No Override', ['OBF/125'], report, {}), ['charizard']);

  // Padding-insensitive: thumbnail "OBF/0125"-style padding differences still
  // match the item (both sides strip leading zeros in the number half).
  assert.deepStrictEqual(resolveArchetypeIcons('base', 'No Override', ['OBF/0125'], report, {}), ['charizard']);

  // Two cards of the same species dedupe to one slug (Python seen_species).
  assert.deepStrictEqual(resolveArchetypeIcons('base', 'No Override', ['TWM/025', 'TWM/111'], report, {}), ['ogerpon']);

  // A thumbnail id that maps to a Trainer (not in the Pokémon name map) is
  // skipped; empty thumbnails produce no icons.
  assert.deepStrictEqual(resolveArchetypeIcons('base', 'No Override', ['SVI/191'], report, {}), []);
  assert.deepStrictEqual(resolveArchetypeIcons('base', 'No Override', [], report, {}), []);
});

test('icons: slugifyPokemonIcon matches Python slugify_pokemon_icon', () => {
  // Hand-ported expectations from download-tournament.py.
  assert.strictEqual(slugifyPokemonIcon('Raging Bolt ex'), 'raging-bolt');
  assert.strictEqual(slugifyPokemonIcon('Dragapult ex'), 'dragapult');
  assert.strictEqual(slugifyPokemonIcon('Iron Thorns ex'), 'iron-thorns');
  assert.strictEqual(slugifyPokemonIcon("N's Zoroark ex"), 'ns-zoroark');
  assert.strictEqual(slugifyPokemonIcon('N’s Zoroark ex'), 'ns-zoroark'); // curly quote
  assert.strictEqual(slugifyPokemonIcon('Mr. Mime'), 'mr-mime');
  assert.strictEqual(slugifyPokemonIcon('Regidrago VSTAR'), 'regidrago');
  assert.strictEqual(slugifyPokemonIcon(''), '');
});

// ---------------------------------------------------------------------------
// Python-profile build shape (hand-ported download-tournament.py expectations)
// ---------------------------------------------------------------------------

test('build: python profile emits icons, six-decimal percent, and (-deckCount, label) index order', () => {
  const decks: ArchetypeDeckInput[] = [
    { archetype: 'Zoroark', cards: [{ name: 'Zoroark ex', set: 'SVP', number: '204', count: 3, category: 'pokemon' }] },
    { archetype: 'Zoroark', cards: [{ name: 'Zoroark ex', set: 'SVP', number: '204', count: 3, category: 'pokemon' }] },
    { archetype: 'Blissey', cards: [{ name: 'Blissey ex', set: 'TWM', number: '134', count: 2, category: 'pokemon' }] },
    { archetype: 'Aggron', cards: [{ name: 'Aggron ex', set: 'SSP', number: '099', count: 2, category: 'pokemon' }] }
  ];
  const masterReport = generateReportFromDecks(decks, decks.length, null);

  const result = buildArchetypeReports(decks, null, {
    nameCasing: 'preserve',
    minDecksFraction: 0, // Python has no min-deck filter
    percentMode: 'fraction6',
    sortMode: 'deckCountThenLabel',
    displayNames: 'trimmed',
    emptyBaseFallback: null,
    thumbnailConfig: {},
    masterReport,
    includeSignatureCards: true,
    iconConfig: {}
  });

  // Sort: Zoroark (2 decks) first, then the 1-deck tie broken by label asc —
  // Python's sort(key=lambda item: (-item["deckCount"], item["label"])).
  assert.deepStrictEqual(
    result.index.map(entry => entry.name),
    ['Zoroark', 'Aggron', 'Blissey']
  );

  // percent: round(count/total, 6) — 2/4 and 1/4 are exact here; the rounding
  // path is pinned by the repeating fraction below.
  assert.deepStrictEqual(
    result.index.map(entry => entry.percent),
    [0.5, 0.25, 0.25]
  );

  // Index entries carry the full Python field set in Python's key order.
  assert.deepStrictEqual(Object.keys(result.index[0]), [
    'name',
    'label',
    'deckCount',
    'percent',
    'thumbnails',
    'signatureCards',
    'icons'
  ]);

  // Icons derived from the archetype's own face Pokemon.
  assert.deepStrictEqual(result.index[0].icons, ['zoroark']);
  assert.deepStrictEqual(result.index[0].thumbnails, ['SVP/204']);

  // Repeating fraction rounds to 6 decimals (Python round(1/3, 6) = 0.333333).
  const thirds = buildArchetypeReports(
    [
      { archetype: 'A', cards: [] },
      { archetype: 'B', cards: [] },
      { archetype: 'C', cards: [] }
    ],
    null,
    {
      nameCasing: 'preserve',
      minDecksFraction: 0,
      percentMode: 'fraction6',
      sortMode: 'deckCountThenLabel',
      displayNames: 'trimmed',
      emptyBaseFallback: null,
      thumbnailConfig: {},
      includeSignatureCards: true,
      iconConfig: {}
    }
  );
  assert.deepStrictEqual(
    thirds.index.map(entry => entry.percent),
    [0.333333, 0.333333, 0.333333]
  );
});

// ---------------------------------------------------------------------------
// Functions path (reportGenerator) — approved output difference migration test
// ---------------------------------------------------------------------------

test('reportGenerator: legacy shape preserved; stale 99.9%-gated thumbnails retired (approved change)', async () => {
  const { buildArchetypeReports: buildFunctionsReports } =
    await import('../../functions/lib/onlineMeta/reportGenerator');

  const decks = [
    {
      archetype: 'Raging Bolt',
      cards: [
        { name: 'Raging Bolt ex', set: 'TEF', number: '123', count: 3, category: 'pokemon' },
        { name: "Professor Sada's Vitality", set: 'PAR', number: '170', count: 4, category: 'trainer' }
      ]
    },
    {
      archetype: 'raging_bolt',
      cards: [{ name: 'Squawkabilly ex', set: 'PAL', number: '169', count: 1, category: 'pokemon' }]
    }
  ];

  const { archetypeFiles, archetypeIndex, minDecks, deckMap } = buildFunctionsReports(decks, 1, null, {
    thumbnailConfig: {}
  });

  // D3 quirk preserved: this producer lowercases, so the two case variants
  // group together under one lowercased base.
  assert.strictEqual(minDecks, 1);
  assert.strictEqual(archetypeFiles.length, 1);
  assert.strictEqual(archetypeFiles[0].base, 'raging_bolt');
  assert.strictEqual(archetypeFiles[0].filename, 'raging_bolt.json');
  assert.strictEqual(archetypeFiles[0].displayName, 'Raging Bolt');
  assert.ok(deckMap.get('raging_bolt'));

  // Legacy index shape preserved exactly: no signatureCards/icons fields.
  assert.deepStrictEqual(Object.keys(archetypeIndex[0]), ['name', 'label', 'deckCount', 'percent', 'thumbnails']);
  assert.strictEqual(archetypeIndex[0].percent, 1);

  // APPROVED CHANGE (recorded): the retired stale engine gated stage-1
  // inference at 99.9% usage — "Raging Bolt ex" at 50% got [] before. The
  // shared engine (online authority, 30% gate) now selects it.
  assert.deepStrictEqual(archetypeIndex[0].thumbnails, ['TEF/123']);
});

// ---------------------------------------------------------------------------
// Grouping profiles (D3 quirks) stay reproducible
// ---------------------------------------------------------------------------

test('deriveArchetypeGrouping reproduces each producer casing profile', () => {
  // Online/Python: case preserved in keys and bases.
  assert.deepStrictEqual(deriveArchetypeGrouping('Gardevoir ex', 'preserve'), {
    key: 'Gardevoir ex',
    base: 'Gardevoir_ex'
  });
  // Functions reportGenerator: lowercased key and base.
  assert.deepStrictEqual(deriveArchetypeGrouping('Gardevoir ex', 'lower'), {
    key: 'gardevoir ex',
    base: 'gardevoir_ex'
  });
  // archetypeBuilder trends fallback quirk: lowercase 'unknown'.
  assert.deepStrictEqual(deriveArchetypeGrouping('***', 'lower', 'unknown'), {
    key: '***',
    base: 'unknown'
  });
  // The 'preserve' profile keeps the simple sanitizer: no '..' removal.
  assert.strictEqual(deriveArchetypeGrouping('Lost.. Box', 'preserve').base, 'Lost.._Box');
  assert.strictEqual(deriveArchetypeGrouping('Lost.. Box', 'lower').base, 'lost_box');
});
