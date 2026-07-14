/**
 * Reconcile derived indexes across every stored event (DB-MASTER-PLAN Phase 5/6).
 *
 * The single batch driver that keeps the legacy derived indexes fresh against
 * the current synonym database: for every event folder it rebuilds
 * `cardUsage.json` + `conversion.json` from the stored `decks.json` (via the
 * consolidated shared builders — parity-verified byte-equivalent to production),
 * reports drift versus what is stored, and rebuilds `reports/tournaments.json`.
 * DRY RUN BY DEFAULT: it only reports; pass `--write` to update R2.
 *
 * This replaces the per-script batch drivers (reprocess-event-indexes.py,
 * rebuild-tournaments-index.py) with one reconciling entry point; a scheduled
 * workflow invokes it instead of the independent Python schedules.
 *
 * Usage: tsx reconcile-indexes.ts [--write] [--limit N]
 * @module .github/scripts/reconcile-indexes
 */

import { pathToFileURL } from 'node:url';
import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import { canonicalStringify } from '../../shared/data/canonicalJson.ts';
import type { SynonymDatabase } from '../../shared/data/cardIdentity.ts';
import { buildTournamentCatalog, reindexFromDecks } from './event-cli.ts';
import { createR2Client, getJsonResult, putJson } from './lib/r2.mjs';

const CACHE_CONTROL = 'public, max-age=21600';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

interface ReconcileDeck {
  archetype?: string;
  cards?: { name?: string; set?: string | null; number?: string | number | null; count?: number }[];
  madePhase2?: boolean;
}

interface UsageRow {
  slug: string;
  found: number;
}
interface UsageIndex {
  usage?: Record<string, UsageRow[]>;
}

/**
 * Normalize a cardUsage index for SEMANTIC comparison: sort each card's
 * archetype array by (found desc, slug). The stored array order is the
 * archetype-iteration order, which the CardPage consumer re-sorts by found at
 * display time — so an order-only difference is not real drift and must not
 * trigger a needless rewrite.
 */
function normalizeUsage(index: UsageIndex | null): string {
  if (!index || typeof index.usage !== 'object' || index.usage === null) return canonicalStringify(index);
  const normalized: Record<string, UsageRow[]> = {};
  for (const [uid, rows] of Object.entries(index.usage)) {
    normalized[uid] = [...(rows as UsageRow[])].sort(
      (a, b) => b.found - a.found || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0)
    );
  }
  return canonicalStringify({ usage: normalized });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const write = argv.includes('--write');
  const limit = argv.includes('--limit') ? Number(argv[argv.indexOf('--limit') + 1]) : Infinity;

  const bucket = requireEnv('R2_BUCKET_NAME');
  const client = createR2Client({
    accountId: requireEnv('R2_ACCOUNT_ID'),
    accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY')
  });
  const read = async <T>(key: string): Promise<T | null> => {
    const r = await getJsonResult<T>(client, bucket, key);
    if (r.status === 'found') return r.value;
    if (r.status === 'missing') return null;
    throw new Error(`failed to read ${key}: ${r.status}`);
  };

  // Discover event folders.
  const folders: string[] = [];
  let token: string | undefined;
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: 'reports/', Delimiter: '/', ContinuationToken: token }));
    for (const p of page.CommonPrefixes ?? []) {
      const folder = (p.Prefix ?? '').replace(/^reports\//, '').replace(/\/$/, '');
      if (folder && folder !== 'Online - Last 14 Days' && folder !== 'Snapshots' && folder !== 'Trends - Last 30 Days') folders.push(folder);
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);

  const synonymDb = await read<SynonymDatabase>('assets/card-synonyms.json');
  const events = folders.filter(f => /^\d{4}-\d{2}-\d{2},/.test(f)).slice(0, limit);
  let usageDrift = 0;
  let conversionDrift = 0;
  let wrote = 0;

  for (const folder of events) {
    const base = `reports/${folder}`;
    const decks = await read<ReconcileDeck[]>(`${base}/decks.json`);
    if (!decks) continue;
    const { cardUsage, conversion } = reindexFromDecks(decks, synonymDb);

    const storedUsage = await read<UsageIndex>(`${base}/cardUsage.json`);
    // Semantic comparison: ignore archetype-array ordering (consumer re-sorts).
    if (normalizeUsage(storedUsage) !== normalizeUsage(cardUsage as UsageIndex)) {
      usageDrift += 1;
      if (write) {
        await putJson(client, bucket, `${base}/cardUsage.json`, cardUsage, { cacheControl: CACHE_CONTROL });
        wrote += 1;
      }
    }
    const storedConv = await read<unknown>(`${base}/conversion.json`);
    if (conversion !== null && canonicalStringify(storedConv) !== canonicalStringify(conversion)) {
      conversionDrift += 1;
      if (write) {
        await putJson(client, bucket, `${base}/conversion.json`, conversion, { cacheControl: CACHE_CONTROL });
        wrote += 1;
      }
    }
  }

  // Catalog.
  const catalog = buildTournamentCatalog(folders);
  const storedCatalog = await read<string[]>('reports/tournaments.json');
  const catalogDrift = canonicalStringify(storedCatalog) !== canonicalStringify(catalog);
  if (catalogDrift && write) {
    await putJson(client, bucket, 'reports/tournaments.json', catalog, { cacheControl: CACHE_CONTROL });
    wrote += 1;
  }

  console.log('[reconcile] ===== SUMMARY =====');
  console.log(`  events scanned      : ${events.length}`);
  console.log(`  cardUsage drift     : ${usageDrift}`);
  console.log(`  conversion drift    : ${conversionDrift}`);
  console.log(`  catalog drift       : ${catalogDrift ? 'yes' : 'no'} (${catalog.length} entries)`);
  console.log(write ? `  objects written     : ${wrote}` : '  DRY RUN — no writes (pass --write to apply)');
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch(error => {
    console.error('[reconcile]', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
