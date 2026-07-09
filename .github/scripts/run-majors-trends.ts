#!/usr/bin/env node

/**
 * Majors-trends precompute.
 *
 * The Trends page's "Majors (events)" view used to download up to ten full
 * `master.json` files (~5 MB total) plus each event's archetype index, purely
 * to compute card movers + an archetype-share timeline in the browser on every
 * visit. This job does that computation once in the pipeline and writes a small
 * artifact (`reports/majors-trends.json`) the page reads instead. The page
 * keeps the client computation as a 404 fallback.
 *
 * It reuses the *exact* computation the page uses (src/lib/majorsTrends.ts) and
 * the same read-time canonicalization (canonicalizeReport) so the artifact is
 * byte-for-byte what the fallback would produce.
 *
 * Reads are plain HTTP GETs against the public R2 base — the same URLs the
 * browser hits — so no R2 credentials are needed to read. The single write
 * (the artifact) uses the S3 API with credentials, exactly like run-trends.ts.
 *
 * Local dry run (read-only, no credentials):
 *   DRY_RUN=1 MAJORS_TRENDS_OUT=/tmp/majors-trends.json npx tsx .github/scripts/run-majors-trends.ts
 */

import process from 'node:process';
import { writeFile } from 'node:fs/promises';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { canonicalizeReport, majorTournaments, tournamentDate, type MasterPayload } from '../../src/lib/data.ts';
import {
  computeMajorsWindowResult,
  type EventSnapshot,
  type MajorsTrendsPayload,
  type MajorsWindowResult
} from '../../src/lib/majorsTrends.ts';
import type { ArchetypeIndexEntry } from '../../src/types/index.ts';
import { EMPTY_DATABASE, type SynonymDatabase } from '../../shared/synonyms.ts';

/** Window sizes the page offers (must match MAJORS_WINDOW_COUNT in TrendsPage). */
const WINDOWS: { key: string; count: number }[] = [
  { key: '3-events', count: 3 },
  { key: '5-events', count: 5 },
  { key: '10-events', count: 10 }
];
/** Largest window — we only ever need this many events. */
const MAX_EVENTS = Math.max(...WINDOWS.map(w => w.count));
const ARTIFACT_KEY = 'majors-trends.json';
/** 6 hours — majors data changes at most a few times a week. */
const CACHE_CONTROL = 'public, max-age=21600';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

// Read the R2 bucket through the authenticated S3 endpoint, not the public
// r2.ciphermaniac.com origin. The public origin sits behind Cloudflare's WAF,
// which intermittently 403s requests from GitHub Actions runner IP ranges; the
// S3 endpoint bypasses it (and the edge cache) the same way run-trends.ts does.
const R2_BUCKET = requireEnv('R2_BUCKET_NAME');
const REPORTS_PREFIX = (process.env.R2_REPORTS_PREFIX || 'reports').replace(/\/+$/, '');
const s3Client = new S3Client({
  region: 'auto',
  endpoint: `https://${requireEnv('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY')
  }
});

/** GET + parse a JSON object from R2 by key. Returns null on 404, throws otherwise. */
async function fetchJson<T>(key: string): Promise<T | null> {
  try {
    const res = await s3Client.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return JSON.parse(await res.Body!.transformToString()) as T;
  } catch (error) {
    const meta = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (meta?.name === 'NoSuchKey' || meta?.$metadata?.httpStatusCode === 404) {
      return null;
    }
    throw error;
  }
}

/** Same as fetchJson but never throws — mirrors the page's Promise.allSettled per-event fetch. */
async function fetchJsonSafe<T>(key: string): Promise<T | null> {
  try {
    return await fetchJson<T>(key);
  } catch (error) {
    console.warn(`[majors-trends] read failed for ${key}:`, (error as Error).message);
    return null;
  }
}

/** Load the synonym DB the same way the browser does (see src/utils/cardSynonyms.ts). */
async function loadSynonymDatabase(): Promise<SynonymDatabase> {
  const data = await fetchJsonSafe<SynonymDatabase>('assets/card-synonyms.json');
  return data ?? EMPTY_DATABASE;
}

/**
 * Fetch one event's master + archetype index and shape it into an EventSnapshot,
 * reproducing exactly what fetchMaster / fetchArchetypes do on the page:
 *  - master is canonicalized (variant printings merged, pct recomputed);
 *  - the raw archetype index is passed through unchanged — computeMajorsArchetypeSeries
 *    re-detects the 0..1 vs 0..100 percent scale per file, so it doesn't need the
 *    page's normalizeIndexPercentScale pre-pass to reach the same numbers.
 */
async function buildSnapshot(tournament: string, db: SynonymDatabase): Promise<EventSnapshot> {
  // S3 object keys use the raw folder name; the SDK handles URL-encoding.
  const [rawMaster, rawArchetypes] = await Promise.all([
    fetchJsonSafe<MasterPayload>(`${REPORTS_PREFIX}/${tournament}/master.json`),
    fetchJsonSafe<ArchetypeIndexEntry[]>(`${REPORTS_PREFIX}/${tournament}/archetypes/index.json`)
  ]);
  return {
    tournament,
    date: tournamentDate(tournament) ?? new Date(0),
    master: rawMaster ? canonicalizeReport(rawMaster, db) : null,
    archetypes: rawArchetypes
  };
}

async function main() {
  const tournaments = (await fetchJson<string[]>(`${REPORTS_PREFIX}/tournaments.json`)) ?? [];
  const majors = majorTournaments(tournaments).slice(0, MAX_EVENTS);
  console.log(`[majors-trends] ${tournaments.length} tournaments, ${majors.length} majors (cap ${MAX_EVENTS})`);
  if (majors.length === 0) {
    throw new Error('No major tournaments found — refusing to publish an empty artifact');
  }

  const db = await loadSynonymDatabase();
  console.log(`[majors-trends] Synonym DB entries: ${Object.keys(db?.synonyms ?? {}).length}`);

  // Snapshots are ordered most-recent first (tournaments.json is), which the
  // recent/older half split in the movers computation relies on.
  const snapshots = await Promise.all(majors.map(t => buildSnapshot(t, db)));
  const withMaster = snapshots.filter(s => s.master !== null).length;
  const withArchetypes = snapshots.filter(s => s.archetypes !== null).length;
  console.log(`[majors-trends] Snapshots: ${snapshots.length} (master=${withMaster}, archetypes=${withArchetypes})`);

  const windows: Record<string, MajorsWindowResult> = {};
  for (const w of WINDOWS) {
    const slice = snapshots.slice(0, w.count);
    // sampleCount mirrors the page's sample().length: the number of events
    // actually available for the window (may be < w.count).
    windows[w.key] = computeMajorsWindowResult(slice, slice.length);
  }

  const payload: MajorsTrendsPayload = {
    generatedAt: new Date().toISOString(),
    windows
  };
  const body = JSON.stringify(payload);

  console.log('[majors-trends] Windows summary:');
  for (const w of WINDOWS) {
    const r = windows[w.key];
    console.log(
      `  ${w.key}: events=${r.sampleCount} days=${r.dayKeys.length} series=${r.series.length} ` +
        `rising=${r.movers.rising.length} falling=${r.movers.falling.length} newcomers=${r.movers.newcomers.length} ` +
        `enoughForMovers=${r.movers.enoughForMovers}`
    );
  }
  console.log(`[majors-trends] Artifact size: ${body.length} bytes`);

  if (process.env.DRY_RUN) {
    const out = process.env.MAJORS_TRENDS_OUT;
    if (out) {
      await writeFile(out, body);
      console.log(`[majors-trends] DRY_RUN: wrote ${out} (skipped R2)`);
    } else {
      console.log(body);
    }
    return;
  }

  const key = `${REPORTS_PREFIX}/${ARTIFACT_KEY}`;
  await s3Client.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: 'application/json',
      CacheControl: CACHE_CONTROL
    })
  );
  console.log(`[majors-trends] Uploaded ${key} (${body.length} bytes)`);
}

main().catch(error => {
  console.error('[majors-trends] Failed', error);
  process.exit(1);
});
