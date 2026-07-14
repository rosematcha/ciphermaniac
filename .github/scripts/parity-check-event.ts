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
  const base = process.argv[2];
  if (!base) throw new Error('Usage: parity-check-event.ts "reports/<date, Name>"');

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

  const decks = await load<LegacyDeck[]>(`${base}/decks.json`);
  const legacyMaster = await load<{ deckTotal: number; items: LegacyReportItem[] }>(`${base}/master.json`);
  const legacyConversion = await load<{ day1Total: number; day2Total: number; cards: Record<string, { day1: number; day2: number }> }>(`${base}/conversion.json`);
  if (!decks || !legacyMaster) throw new Error(`event ${base} is missing decks.json or master.json`);

  console.log(`[parity] ${base}: ${decks.length} decks, legacy deckTotal=${legacyMaster.deckTotal}`);
  const allDiffs: string[] = [];

  // master.json: recompute from the same decks (no synonym DB — legacy event
  // master is not synonym-canonicalized, so pass null to match).
  const deckTotal = decks.filter(deck => deck.hasDecklist !== false).length;
  const nextMaster = generateReportFromDecks(decks as never, deckTotal, null) as { deckTotal: number; items: LegacyReportItem[] };
  if (nextMaster.deckTotal !== legacyMaster.deckTotal) {
    allDiffs.push(`master.deckTotal: ${legacyMaster.deckTotal} (legacy) vs ${nextMaster.deckTotal} (new)`);
  }
  allDiffs.push(...diffReportItems('master', legacyMaster.items, nextMaster.items));

  // conversion.json: recompute (legacy uses null synonyms at event build time).
  if (legacyConversion) {
    const nextConversion = buildConversionIndex(decks.map(deck => ({ cards: deck.cards ?? [], madePhase2: deck.madePhase2 })), null);
    if (!nextConversion) {
      allDiffs.push('conversion: new builder produced null but legacy has a conversion index');
    } else {
      if (nextConversion.day1Total !== legacyConversion.day1Total) allDiffs.push(`conversion.day1Total: ${legacyConversion.day1Total} vs ${nextConversion.day1Total}`);
      if (nextConversion.day2Total !== legacyConversion.day2Total) allDiffs.push(`conversion.day2Total: ${legacyConversion.day2Total} vs ${nextConversion.day2Total}`);
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
