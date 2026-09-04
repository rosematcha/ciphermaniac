#!/usr/bin/env tsx
/**
 * AdvancedPanel transform benchmark (DB-MASTER-PLAN Phase 7.5).
 *
 * Phase 7.5 gates a Web Worker on profiling, not intuition: "If filtering /
 * co-occurrence work blocks the main thread for a meaningful duration (for
 * example sustained > ~50 ms tasks on target hardware), prototype moving the
 * pure analysis stage into a Worker." This measures the transforms so that
 * decision has a number behind it.
 *
 * Input is the largest real archetype's shape — 1,134 decks of ~25 cards
 * (Dragapult on the current online ladder) — synthesized from the committed
 * 25-deck fixture so the benchmark runs offline and deterministically.
 *
 * The headline figure is the COLD path (everything that runs once when the
 * panel opens) versus the WARM path (what re-runs on each filter apply and each
 * threshold tick). Only the warm path can make the UI feel stuck.
 *
 * Usage: npx tsx tests/perf/advanced-panel.bench.ts [deckCount]
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateReportAndCooccurrence } from '../../shared/clientSideFiltering.ts';
import type { SynonymDatabase } from '../../shared/data/cardIdentity.ts';
import type { CardItem, Deck } from '../../src/types/index.ts';
import {
  applyFilters,
  buildBaselinePct,
  canonicalizeDecks,
  indexItemsByCardId,
  reconcileDisplayedItems,
  rulesToFilters
} from '../../src/components/advancedPanel/model.ts';
import type { Rule } from '../../src/utils/buildState.ts';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/e2e');
const ARCHETYPE = 'Dragapult';
const SLUG = ARCHETYPE;
const TARGET_DECKS = Number(process.argv[2] ?? 1134);

function readJson<T>(rel: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, rel), 'utf8')) as T;
}

/**
 * Grow the fixture to production scale.
 *
 * Decks are cloned with a fresh id and a rotated card slice so the corpus has
 * realistic variety rather than N copies of one list — a uniform corpus would
 * make the co-occurrence index unrealistically small and flatter the numbers.
 */
function synthesize(seed: Deck[], count: number): Deck[] {
  const out: Deck[] = [];
  for (let i = 0; i < count; i++) {
    const base = seed[i % seed.length];
    const cards = base.cards ?? [];
    // Drop one rotating card so decks differ in composition, not just id.
    const omit = cards.length ? i % cards.length : -1;
    out.push({
      ...base,
      id: `synth-${i}`,
      deckId: `synth-${i}`,
      cards: cards.filter((_, idx) => idx !== omit)
    } as Deck);
  }
  return out;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

interface Timing {
  label: string;
  medianMs: number;
  maxMs: number;
  runs: number;
}

function bench(label: string, iterations: number, run: () => unknown): Timing {
  // One warm-up so JIT compilation is not charged to the first sample.
  run();
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    run();
    samples.push(performance.now() - t0);
  }
  return { label, medianMs: median(samples), maxMs: Math.max(...samples), runs: iterations };
}

// ---------------------------------------------------------------------------

const seedDecks = readJson<Deck[]>(`reports/Online - Last 14 Days/archetypes/${ARCHETYPE}/decks.json`);
const report = readJson<{ deckTotal: number; items: CardItem[] }>(
  `reports/Online - Last 14 Days/archetypes/${ARCHETYPE}/cards.json`
);
const synonymDb = readJson<SynonymDatabase>('assets/card-synonyms.json');

const decks = synthesize(seedDecks, TARGET_DECKS);
const cardCount = decks.reduce((n, d) => n + (d.cards?.length ?? 0), 0);

console.log(
  `AdvancedPanel transforms — ${decks.length} decks, ${cardCount} card rows, ${report.items.length} report items`
);
console.log(`synonym db: ${Object.keys(synonymDb.synonyms).length} mappings\n`);

// --- Rules used by both the cold first apply and the warm path ---
const rules: Rule[] = [
  { id: 1, cardId: 'PRE~073', name: 'Dragapult ex', mode: 'include', countOp: '>=', count: 2 },
  { id: 2, cardId: 'TWM~128', name: 'Dreepy', mode: 'include', countOp: '>=', count: 1 }
] as Rule[];
const filters = rulesToFilters(rules);

// --- Cold path: runs once when the panel opens ---
const canonical = canonicalizeDecks(decks, synonymDb);
const cold: Timing[] = [
  bench('canonicalizeDecks', 20, () => canonicalizeDecks(decks, synonymDb)),
  bench('indexItemsByCardId', 50, () => indexItemsByCardId(report.items, synonymDb)),
  bench('buildBaselinePct', 20, () => buildBaselinePct(canonical, report.items)),
  // clientSideFiltering memoizes per-deck card counts keyed by deck identity, so
  // re-running against the same objects measures a warm cache. Canonicalizing
  // afresh each iteration produces new deck objects and therefore a cold one —
  // which is what the first apply after the panel opens actually pays.
  // The whole cold sequence in one go. The rows above are its breakdown, so the
  // ONE PASS figure uses this rather than their sum, which would charge the deck
  // clone twice. Canonicalizing afresh each iteration also produces new deck
  // objects, so clientSideFiltering's identity-keyed count cache starts cold —
  // which is what the panel actually pays on open.
  bench('WHOLE COLD PATH', 10, () => {
    const fresh = canonicalizeDecks(decks, synonymDb);
    indexItemsByCardId(report.items, synonymDb);
    buildBaselinePct(fresh, report.items);
    return generateReportAndCooccurrence(applyFilters(fresh, SLUG, 'all', filters), SLUG, []);
  })
];

// --- Warm path: runs on every filter apply ---
const filtered = applyFilters(canonical, SLUG, 'all', filters);
const analysis = generateReportAndCooccurrence(filtered, SLUG, []);

console.log(`filters keep ${filtered.length} of ${canonical.length} decks\n`);

const warm: Timing[] = [
  bench('rulesToFilters', 200, () => rulesToFilters(rules)),
  bench('applyFilters (2 rules)', 50, () => applyFilters(canonical, SLUG, 'all', filters)),
  bench('applyFilters (success bracket)', 50, () => applyFilters(canonical, SLUG, 'top8', filters)),
  // The unfiltered aggregation is the honest worst case: it is what runs on the
  // FIRST apply, before any rule narrows the corpus, and over every deck.
  bench('generateReportAndCooccurrence (all decks)', 20, () => generateReportAndCooccurrence(canonical, SLUG, [])),
  bench('generateReportAndCooccurrence (filtered)', 20, () => generateReportAndCooccurrence(filtered, SLUG, []))
];

// --- Slider path: runs on every threshold tick ---
const items = analysis.report.items as unknown as Parameters<typeof reconcileDisplayedItems>[0];
let prev = reconcileDisplayedItems(items, 0, new Map()).byCardId;
const slider: Timing[] = [
  bench('reconcileDisplayedItems', 200, () => {
    prev = reconcileDisplayedItems(items, 10, prev).byCardId;
  })
];

/**
 * Print a group. `pathLabels` names the subset that actually runs in sequence
 * on one pass — summing every row would double-count variants measured side by
 * side (only one `generateReportAndCooccurrence` runs per apply).
 */
function table(title: string, rows: Timing[], pathLabels: string[]): number {
  console.log(title);
  for (const r of rows) {
    const onPath = pathLabels.includes(r.label);
    const flag = r.medianMs > 50 ? '  <-- over 50ms' : '';
    console.log(
      `${onPath ? ' ' : '~'} ${r.label.padEnd(42)} ${r.medianMs.toFixed(2).padStart(8)} ms  (max ${r.maxMs.toFixed(2)} ms)${flag}`
    );
  }
  const total = rows.filter(r => pathLabels.includes(r.label)).reduce((n, r) => n + r.medianMs, 0);
  console.log(`  ${'ONE PASS'.padEnd(42)} ${total.toFixed(2).padStart(8)} ms   (~ rows are alternatives)\n`);
  return total;
}

const coldTotal = table('COLD — once, when the panel opens:', cold, ['WHOLE COLD PATH']);
const warmTotal = table('WARM — every filter apply:', warm, [
  'rulesToFilters',
  'applyFilters (2 rules)',
  'generateReportAndCooccurrence (all decks)'
]);
const sliderTotal = table('SLIDER — every threshold tick (debounced):', slider, ['reconcileDisplayedItems']);

const PHONE_FACTOR = 4;
console.log('Phase 7.5 gate: a Web Worker is justified only if a single pass sustains > ~50 ms.');
console.log(
  `  this machine       cold ${coldTotal.toFixed(1)} ms | warm ${warmTotal.toFixed(1)} ms | slider ${sliderTotal.toFixed(2)} ms`
);
console.log(
  `  ~4x slower phone   cold ${(coldTotal * PHONE_FACTOR).toFixed(0)} ms | warm ${(warmTotal * PHONE_FACTOR).toFixed(0)} ms | slider ${(sliderTotal * PHONE_FACTOR).toFixed(1)} ms`
);
console.log(
  '  The cold path already runs after first paint (the panel defers it behind rAF), so it costs\n' +
    '  responsiveness only if it overruns a frame while the user is interacting.'
);
