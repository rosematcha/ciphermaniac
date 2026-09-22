/**
 * Build `static/set-impact.json`: how much of every major each set supplied.
 *
 * Reads the production release from public R2: every event's decks, the card
 * synonyms (to find a card's other printings) and card types (for regulation
 * marks). Event roots are content-addressed, so they're cached under
 * `.cache/set-impact/` and a rebuild only downloads events it hasn't seen.
 * Meant to run by hand, about once a month.
 *
 * Usage:
 *   npx tsx scripts/build-set-impact.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { requireSynonymDatabase, type SynonymDatabase } from '../shared/data/cardIdentity';
import { createSetImpactBuilder, type ImpactDeck, type RegulationMarks } from '../shared/setImpact/build';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = join(ROOT, '.cache', 'set-impact');
const OUT_PATH = join(ROOT, 'static', 'set-impact.json');
const R2_BASE = 'https://r2.ciphermaniac.com';
// The public bucket caches per Origin; ask as the site does.
const HEADERS = { Origin: 'https://ciphermaniac.com' };

interface Manifest {
  releaseId: string;
  roots: { assets: string };
  events: Record<string, string>;
}

interface EventIndex {
  date: string;
  name: string;
  participantCount?: number;
}

async function fetchJson<T>(path: string): Promise<T> {
  const url = `${R2_BASE}${encodeURI(path.startsWith('/') ? path : `/${path}`)}`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    throw new Error(`${url}: HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

/** Immutable paths only: the cache never expires. */
async function cachedJson<T>(path: string): Promise<T> {
  const file = join(CACHE_DIR, path.replace(/^\/+/, '').replace(/[^\w.-]+/g, '_'));
  if (existsSync(file)) {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  }
  const body = await fetchJson<T>(path);
  writeFileSync(file, JSON.stringify(body), 'utf8');
  return body;
}

async function loadManifest(): Promise<Manifest> {
  const pointer = await fetchJson<{ releaseId: string; manifest: string }>('/current.json');
  return fetchJson<Manifest>(pointer.manifest);
}

function marksFrom(cardTypes: Record<string, { regulationMark?: string | null }>): RegulationMarks {
  return Object.fromEntries(Object.entries(cardTypes).map(([key, entry]) => [key, entry.regulationMark]));
}

async function main(): Promise<void> {
  const t0 = Date.now();
  mkdirSync(CACHE_DIR, { recursive: true });
  const manifest = await loadManifest();
  const [synonyms, cardTypes] = await Promise.all([
    cachedJson<SynonymDatabase>(`${manifest.roots.assets}/card-synonyms.json`),
    cachedJson<Record<string, { regulationMark?: string | null }>>(`${manifest.roots.assets}/data/card-types.json`)
  ]);
  const builder = createSetImpactBuilder(requireSynonymDatabase(synonyms, 'set impact'), marksFrom(cardTypes));

  const roots = Object.keys(manifest.events)
    .sort()
    .map(folder => manifest.events[folder]);
  for (const root of roots) {
    const [index, decks] = await Promise.all([
      cachedJson<EventIndex>(`${root}/index.json`),
      cachedJson<ImpactDeck[]>(`${root}/decks.json`)
    ]);
    builder.addEvent({ date: index.date, name: index.name, players: index.participantCount ?? decks.length, decks });
  }

  const payload = builder.finish(new Date().toISOString());
  if (payload.sets.length === 0) {
    throw new Error('No sets scored — refusing to overwrite the existing file');
  }
  writeFileSync(OUT_PATH, `${JSON.stringify(payload)}\n`, 'utf8');

  const misses = [...builder.unattributed].sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (misses.length > 0) {
    console.warn(
      `[set-impact] No legal printing for ${builder.unattributed.size} cards; most played: ${misses
        .map(([uid, share]) => `${uid} (${share.toFixed(2)})`)
        .join(', ')}`
    );
  }
  console.log(
    `[set-impact] Wrote ${payload.sets.length} sets over ${payload.events.length} events (release ${
      manifest.releaseId
    }) to ${OUT_PATH} in ${((Date.now() - t0) / 1000).toFixed(1)}s`
  );
}

main().catch((err: unknown) => {
  console.error('[set-impact] Failed', err);
  process.exit(1);
});
