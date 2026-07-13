/**
 * tests/data/artifacts.test.ts
 * Golden-fixture and invariant tests for the serving-artifact contract. Proves
 * the four core artifacts build from normalized decks, validate, hash to stable
 * snapshots, are permutation-invariant and idempotent, and that every
 * artifact-level invariant violation is rejected by the right validator.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  type ArchetypeIndex,
  type CardReport,
  type ConversionIndex,
  type CardUsageIndex,
  buildArchetypeCardReports,
  buildArchetypeIndex,
  buildCardReport,
  buildCardUsageIndex,
  buildConversionIndex,
  validateArchetypeIndex,
  validateCardReport,
  validateCardUsageIndex,
  validateConversionIndex
} from '../../shared/data/artifacts.ts';
import { type NormalizedEvent, parseCardUid } from '../../shared/data/contracts.ts';
import { canonicalStringify } from '../../shared/data/canonicalJson.ts';
import { sha256Hex } from '../../shared/data/hash.ts';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'data-pipeline');

function loadFixture(name: string): NormalizedEvent {
  return JSON.parse(readFileSync(join(fixturesDir, name), 'utf8')) as NormalizedEvent;
}

const labs = loadFixture('labs-event.json');
const online = loadFixture('online-window.json');

/** Deep clone that works for our JSON-shaped artifacts. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const labsCardReport = buildCardReport(labs.decks);
const labsArchetypeIndex = buildArchetypeIndex(labs.decks);
const labsCardUsage = buildCardUsageIndex(buildArchetypeCardReports(labs.decks));
const labsConversion = buildConversionIndex(labs.decks, labs.participants);

const onlineCardReport = buildCardReport(online.decks);
const onlineArchetypeIndex = buildArchetypeIndex(online.decks);
const onlineCardUsage = buildCardUsageIndex(buildArchetypeCardReports(online.decks));
const onlineConversion = buildConversionIndex(online.decks, online.participants);

// ============================================================================
// Build + validate
// ============================================================================

test('labs artifacts build and validate', () => {
  const report = validateCardReport(labsCardReport);
  assert.deepStrictEqual(report.ok ? [] : report.errors, []);
  assert.strictEqual(validateArchetypeIndex(labsArchetypeIndex).ok, true);
  assert.strictEqual(validateCardUsageIndex(labsCardUsage).ok, true);
  assert.strictEqual(validateConversionIndex(labsConversion).ok, true);
});

test('online artifacts build and validate (except conversion, which has no Day 2)', () => {
  assert.strictEqual(validateCardReport(onlineCardReport).ok, true);
  assert.strictEqual(validateArchetypeIndex(onlineArchetypeIndex).ok, true);
  assert.strictEqual(validateCardUsageIndex(onlineCardUsage).ok, true);
  // An online window has no Day 2, so its conversion index is not valid.
  assert.strictEqual(onlineConversion.day2Total, 0);
  const result = validateConversionIndex(onlineConversion);
  assert.strictEqual(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.some(error => error.includes('requires a Day 2')));
  }
});

// ============================================================================
// Golden snapshots — hardcoded hex so any semantic change fails loudly
// ============================================================================

const SNAPSHOTS: Record<string, string> = {
  'labs.cardReport': 'c81d5617c646522064a1fc39aa44adc4174d22e54e0ca83fce59b6bedc18506d',
  'labs.archetypeIndex': 'b61c3560c993b7ff2c1fc901a4acc3edb5d48b03d9d402ea597c4468959e3aac',
  'labs.cardUsageIndex': 'b973f9718d107ed212df31b9baf77fee28cf6900a2abb55255eb83e2eefae3d9',
  'labs.conversionIndex': '4870fa627bbe4846db3ca6b6c286c4c890b1e3e41d66f74e6c3ab117882fd28c',
  'online.cardReport': 'ca88d12fd19a3864bd7bd2dd2548885f0b331ac911c14e386dc812021f5178dd',
  'online.archetypeIndex': '1373458aa3678d8d9b418685187b4089edad179e58f2e878f6fe7c949989b485',
  'online.cardUsageIndex': '7548126d532799a74301dd04605650b87fa2c5c448ce890a5af3170429159634'
};

test('built artifacts match their golden snapshot hashes', () => {
  assert.strictEqual(sha256Hex(labsCardReport), SNAPSHOTS['labs.cardReport']);
  assert.strictEqual(sha256Hex(labsArchetypeIndex), SNAPSHOTS['labs.archetypeIndex']);
  assert.strictEqual(sha256Hex(labsCardUsage), SNAPSHOTS['labs.cardUsageIndex']);
  assert.strictEqual(sha256Hex(labsConversion), SNAPSHOTS['labs.conversionIndex']);
  assert.strictEqual(sha256Hex(onlineCardReport), SNAPSHOTS['online.cardReport']);
  assert.strictEqual(sha256Hex(onlineArchetypeIndex), SNAPSHOTS['online.archetypeIndex']);
  assert.strictEqual(sha256Hex(onlineCardUsage), SNAPSHOTS['online.cardUsageIndex']);
});

// ============================================================================
// Determinism — permuted input and repeated builds are byte-identical
// ============================================================================

/** Deterministic permutation of an array (reverse + rotate), independent of input order. */
function permute<T>(items: T[]): T[] {
  const reversed = [...items].reverse();
  return [...reversed.slice(1), reversed[0]];
}

test('permuting the input decks yields byte-identical artifacts', () => {
  const decks = permute(labs.decks);
  const participants = permute(labs.participants);
  assert.strictEqual(canonicalStringify(buildCardReport(decks)), canonicalStringify(labsCardReport));
  assert.strictEqual(canonicalStringify(buildArchetypeIndex(decks)), canonicalStringify(labsArchetypeIndex));
  assert.strictEqual(
    canonicalStringify(buildCardUsageIndex(buildArchetypeCardReports(decks))),
    canonicalStringify(labsCardUsage)
  );
  assert.strictEqual(
    canonicalStringify(buildConversionIndex(decks, participants)),
    canonicalStringify(labsConversion)
  );
});

test('rebuilding twice produces identical artifacts', () => {
  assert.strictEqual(sha256Hex(buildCardReport(labs.decks)), sha256Hex(labsCardReport));
  assert.strictEqual(sha256Hex(buildArchetypeIndex(labs.decks)), sha256Hex(labsArchetypeIndex));
  assert.strictEqual(
    sha256Hex(buildCardUsageIndex(buildArchetypeCardReports(labs.decks))),
    sha256Hex(labsCardUsage)
  );
});

// ============================================================================
// Cross-checks the plan names
// ============================================================================

test('distribution player counts sum to foundCount for every card', () => {
  for (const item of labsCardReport.items) {
    const sum = item.dist.reduce((total, entry) => total + entry.players, 0);
    assert.strictEqual(sum, item.foundCount, `dist sum mismatch for ${item.uid}`);
  }
});

test('every report item set/number agrees with its canonical UID', () => {
  for (const item of labsCardReport.items) {
    const parsed = parseCardUid(item.uid);
    assert.ok(parsed, `unparseable uid ${item.uid}`);
    assert.strictEqual(item.set, parsed.set);
    assert.strictEqual(item.number, parsed.number);
    assert.strictEqual(item.name, parsed.name);
  }
});

test('card usage slugs resolve into the archetype index slugs', () => {
  const indexSlugs = new Set(labsArchetypeIndex.archetypes.map(entry => entry.identity.slug));
  for (const rows of Object.values(labsCardUsage.usage)) {
    for (const row of rows) {
      assert.ok(indexSlugs.has(row.slug), `usage slug "${row.slug}" not in archetype index`);
    }
  }
});

test('tied foundCount items are ordered by name (tie-breaker exercised)', () => {
  // The labs fixture has four cards found in exactly two decks — all usagePct 50 —
  // so their relative order is decided purely by the name tie-breaker.
  const tied = labsCardReport.items.filter(item => item.foundCount === 2);
  assert.strictEqual(tied.length, 4);
  assert.deepStrictEqual(
    tied.map(item => item.name),
    ['Basic Fire Energy', 'Charizard ex', 'Gardevoir ex', 'Pidgeot ex']
  );
  // They occupy ranks 1..4, ahead of every once-seen card.
  assert.deepStrictEqual(
    tied.map(item => item.rank),
    [1, 2, 3, 4]
  );
});

// ============================================================================
// Invariant violations — every mutation must be rejected by the right validator
// ============================================================================

test('rejects a card report where foundCount exceeds deckTotal', () => {
  const report = clone(labsCardReport);
  report.items[0].foundCount = report.deckTotal + 1;
  const result = validateCardReport(report);
  assert.strictEqual(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.some(error => error.includes('exceeds deckTotal')));
  }
});

test('rejects a distribution whose players do not sum to foundCount', () => {
  const report = clone(labsCardReport);
  report.items[0].dist[0].players += 1;
  const result = validateCardReport(report);
  assert.strictEqual(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.some(error => error.includes('player counts sum to')));
  }
});

test('rejects a non-contiguous rank', () => {
  const report = clone(labsCardReport);
  report.items[1].rank = 99;
  const result = validateCardReport(report);
  assert.strictEqual(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.some(error => error.includes('rank: expected 2')));
  }
});

test('rejects items that are out of the canonical sort order', () => {
  const report = clone(labsCardReport);
  report.items.reverse();
  // Re-rank so ranks stay 1-based and contiguous; only the ORDER is wrong now.
  report.items.forEach((item, index) => {
    item.rank = index + 1;
  });
  const result = validateCardReport(report);
  assert.strictEqual(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.some(error => error.includes('not in canonical sort order')));
  }
});

test("rejects a report item whose set disagrees with its UID", () => {
  const report = clone(labsCardReport);
  const withSet = report.items.find(item => item.set !== null);
  assert.ok(withSet);
  withSet.set = 'XXX';
  const result = validateCardReport(report);
  assert.strictEqual(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.some(error => error.includes('does not match UID set')));
  }
});

test('rejects a wrong sharePct in the archetype index', () => {
  const index: ArchetypeIndex = clone(labsArchetypeIndex);
  index.archetypes[0].sharePct = 99;
  const result = validateArchetypeIndex(index);
  assert.strictEqual(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.some(error => error.includes('inconsistent with deckCount/deckTotal')));
  }
});

test('rejects an archetype index that is out of order', () => {
  const index = clone(labsArchetypeIndex);
  index.archetypes.reverse();
  const result = validateArchetypeIndex(index);
  assert.strictEqual(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.some(error => error.includes('not in canonical sort order')));
  }
});

test('rejects a conversion card whose day2 exceeds day1', () => {
  const conversion: ConversionIndex = clone(labsConversion);
  const uid = Object.keys(conversion.cards)[0];
  conversion.cards[uid].day2 = conversion.cards[uid].day1 + 1;
  const result = validateConversionIndex(conversion);
  assert.strictEqual(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.some(error => error.includes(`cards["${uid}"].day2`)));
  }
});

test('rejects a conversion index with no Day 2 population', () => {
  const conversion = clone(labsConversion);
  conversion.day2Total = 0;
  const result = validateConversionIndex(conversion);
  assert.strictEqual(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.some(error => error.includes('requires a Day 2')));
  }
});

test('rejects a card usage index keyed by an unparseable UID', () => {
  const index: CardUsageIndex = clone(labsCardUsage);
  const uid = Object.keys(index.usage)[0];
  index.usage['Bad::Two'] = index.usage[uid];
  const result = validateCardUsageIndex(index);
  assert.strictEqual(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.some(error => error.includes('unparseable UID key')));
  }
});

test('collects all errors rather than stopping at the first', () => {
  const report: CardReport = clone(labsCardReport);
  report.items[0].foundCount = report.deckTotal + 1;
  report.items[1].rank = 42;
  const result = validateCardReport(report);
  assert.strictEqual(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.length >= 2, `expected >=2 errors, got ${result.errors.length}`);
  }
});
