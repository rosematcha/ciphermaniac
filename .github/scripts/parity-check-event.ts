/**
 * Production parity check: new shared builders vs live legacy artifacts.
 *
 * READ-ONLY against production. Fetches a real event's stored `decks.json` and
 * the legacy `master.json` / `cardUsage.json` / `conversion.json`, recomputes
 * those derived artifacts from the SAME decks using the consolidated shared
 * builders, and reports semantic differences. This is the Phase 6 "compare
 * bytes where semantics should remain identical" gate, run against real data —
 * it never writes anything.
 *
 * Usage: tsx parity-check-event.ts "reports/<date, Name>"
 * @module .github/scripts/parity-check-event
 */

import { pathToFileURL } from 'node:url';
import { generateReportFromDecks } from '../../shared/data/reports/cardReport.ts';
import { buildConversionIndex } from '../../shared/data/reports/conversion.ts';
import { buildCardUsageIndex } from '../../shared/data/reports/cardUsage.ts';
import { buildArchetypeReports } from '../../shared/data/archetypes/build.ts';
import { makeRollingResolver } from '../../shared/data/canonicalPrint.ts';
import type { SynonymDatabase } from '../../shared/data/cardIdentity.ts';
import { createR2Client, getJsonResult } from './lib/r2.mjs';

interface LegacyDeck {
  cards?: { name?: string; set?: string; number?: string | number; count?: number }[];
  madePhase2?: boolean;
  hasDecklist?: boolean;
}

interface LegacyReportItem {
  name: string;
  uid?: string;
  found: number;
  pct: number;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

/** Compare two report item lists by (uid|name) -> found, ignoring order. */
function diffReportItems(label: string, legacy: LegacyReportItem[], next: LegacyReportItem[]): string[] {
  const diffs: string[] = [];
  const keyOf = (item: LegacyReportItem): string => item.uid || item.name;
  const legacyMap = new Map(legacy.map(item => [keyOf(item), item]));
  const nextMap = new Map(next.map(item => [keyOf(item), item]));
  for (const [key, item] of legacyMap) {
    const other = nextMap.get(key);
    if (!other) diffs.push(`${label}: legacy has "${key}" (found=${item.found}); new does not`);
    else if (other.found !== item.found) diffs.push(`${label}: "${key}" found ${item.found} (legacy) vs ${other.found} (new)`);
  }
  for (const key of nextMap.keys()) {
    if (!legacyMap.has(key)) diffs.push(`${label}: new has "${key}"; legacy does not`);
  }
  return diffs;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const base = args[0];
  // The online window master IS synonym-canonicalized (D5); event master is not
  // (legacy). --rolling recomputes with the event-date rolling resolver instead,
  // for checking parity against ROLLING-rebaked production artifacts.
  const canonicalize = process.argv.includes('--canonicalize');
  const rolling = process.argv.includes('--rolling');
  if (!base) throw new Error('Usage: parity-check-event.ts "reports/<date, Name>" [--canonicalize|--rolling]');

  const client = createR2Client({
    accountId: requireEnv('R2_ACCOUNT_ID'),
    accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY')
  });
  const bucket = requireEnv('R2_BUCKET_NAME');

  const load = async <T>(key: string): Promise<T | null> => {
    const result = await getJsonResult<T>(client, bucket, key);
    if (result.status === 'found') return result.value;
    if (result.status === 'missing') return null;
    throw new Error(`failed to read ${key}: ${result.status}`);
  };

  const decks = await load<(LegacyDeck & { archetype?: string })[]>(`${base}/decks.json`);
  const legacyMaster = await load<{ deckTotal: number; items: LegacyReportItem[] }>(`${base}/master.json`);
  const legacyConversion = await load<{ day1Total: number; day2Total: number; cards: Record<string, { day1: number; day2: number }> }>(`${base}/conversion.json`);
  const legacyUsage = await load<{ usage: Record<string, { slug: string; found: number }[]> }>(`${base}/cardUsage.json`);
  const legacyArchIndex = await load<{ name: string; deckCount: number }[]>(`${base}/archetypes/index.json`);
  const synonyms = await load<SynonymDatabase>('assets/card-synonyms.json');
  if (!decks || !legacyMaster) throw new Error(`event ${base} is missing decks.json or master.json`);

  console.log(`[parity] ${base}: ${decks.length} decks, legacy deckTotal=${legacyMaster.deckTotal}`);
  const allDiffs: string[] = [];

  let resolveUid: ((uid: string) => string) | undefined;
  if (rolling) {
    if (!synonyms) throw new Error('--rolling requires assets/card-synonyms.json');
    const asOfDate = /^(\d{4}-\d{2}-\d{2}),/.exec(base.replace(/^reports\//, ''))?.[1];
    if (!asOfDate) throw new Error(`--rolling: cannot derive the event date from "${base}"`);
    const printPrices = await load<{ prices?: Record<string, number | null> }>(`assets/print-prices/${asOfDate}.json`);
    resolveUid = makeRollingResolver(synonyms, asOfDate, printPrices?.prices ?? null);
  }

  // master.json: recompute from the same decks (no synonym DB — legacy event
  // master is not synonym-canonicalized, so pass null to match; --rolling
  // matches rolling-rebaked artifacts instead).
  const deckTotal = decks.filter(deck => deck.hasDecklist !== false).length;
  const nextMaster = generateReportFromDecks(
    decks as never,
    deckTotal,
    canonicalize || rolling ? (synonyms ?? null) : null,
    { resolveUid }
  ) as { deckTotal: number; items: LegacyReportItem[] };
  if (nextMaster.deckTotal !== legacyMaster.deckTotal) {
    allDiffs.push(`master.deckTotal: ${legacyMaster.deckTotal} (legacy) vs ${nextMaster.deckTotal} (new)`);
  }
  allDiffs.push(...diffReportItems('master', legacyMaster.items, nextMaster.items));

  // conversion.json: recompute (legacy uses null synonyms at event build time).
  if (legacyConversion) {
    const nextConversion = buildConversionIndex(
      decks.map(deck => ({ cards: deck.cards ?? [], madePhase2: deck.madePhase2 })),
      rolling ? (synonyms ?? null) : null,
      { resolveUid }
    );
    if (!nextConversion) {
      allDiffs.push('conversion: new builder produced null but legacy has a conversion index');
    } else {
      if (nextConversion.day1Total !== legacyConversion.day1Total) allDiffs.push(`conversion.day1Total: ${legacyConversion.day1Total} vs ${nextConversion.day1Total}`);
      if (nextConversion.day2Total !== legacyConversion.day2Total) allDiffs.push(`conversion.day2Total: ${legacyConversion.day2Total} vs ${nextConversion.day2Total}`);
    }
  }

  // cardUsage.json: rebuild archetype reports (Python profile + synonyms) then
  // invert to the usage index, and compare per-uid slug found counts.
  if (legacyUsage) {
    const built = buildArchetypeReports(
      decks.map(deck => ({ cards: deck.cards ?? [], archetype: deck.archetype })),
      synonyms ?? null,
      { nameCasing: 'preserve', minDecksFraction: 0, percentMode: 'fraction6', sortMode: 'deckCountThenLabel', displayNames: 'trimmed', emptyBaseFallback: null, includeSignatureCards: false, resolveUid }
    );
    // Archetype index deckCount per slug should match legacy exactly.
    if (legacyArchIndex) {
      const nextByName = new Map(built.index.map(entry => [entry.name, entry.deckCount]));
      for (const entry of legacyArchIndex) {
        const next = nextByName.get(entry.name);
        if (next !== entry.deckCount) allDiffs.push(`archetypeIndex "${entry.name}": deckCount ${entry.deckCount} (legacy) vs ${next ?? 'absent'} (new)`);
      }
    }
    const nextUsage = buildCardUsageIndex(built.files).usage;
    const usageFound = (rows: { slug: string; found: number }[]): Map<string, number> => new Map(rows.map(r => [r.slug, r.found]));
    let usageDiffs = 0;
    for (const [uid, rows] of Object.entries(legacyUsage.usage)) {
      const next = nextUsage[uid];
      if (!next) { allDiffs.push(`cardUsage: legacy has uid "${uid}"; new does not`); usageDiffs++; continue; }
      const nf = usageFound(next);
      for (const row of rows) {
        if (nf.get(row.slug) !== row.found) { allDiffs.push(`cardUsage["${uid}"] slug "${row.slug}": found ${row.found} (legacy) vs ${nf.get(row.slug) ?? 'absent'} (new)`); usageDiffs++; }
      }
      if (usageDiffs > 40) break;
    }
  }

  if (allDiffs.length === 0) {
    console.log(`[parity] PASS — new builders match legacy artifacts for ${base}`);
  } else {
    console.log(`[parity] ${allDiffs.length} semantic difference(s):`);
    for (const diff of allDiffs.slice(0, 40)) console.log(`  - ${diff}`);
    if (allDiffs.length > 40) console.log(`  … and ${allDiffs.length - 40} more`);
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch(error => {
    console.error('[parity]', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
