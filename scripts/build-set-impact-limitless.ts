/**
 * One-off: build `static/set-impact.json` from Limitless's Day 2 decklist
 * database (tournaments 261-577), which reaches back to 2022, instead of our
 * own event releases, which start at Baltimore 2024.
 *
 * Every event is cut to the same placement percentile (DEPTH of the field) so
 * shares compare like with like; events whose lists don't reach that deep are
 * left out as incomplete. Cards Limitless lists that our synonym database
 * doesn't know get their printings from their Limitless print table, the way
 * the synonyms job builds clusters, so older reprints still merge.
 *
 * Everything fetched is cached under `.cache/limitless-day2/`, so a rerun
 * only downloads what's missing. Requests are spaced a second apart.
 *
 * Usage:
 *   npx tsx scripts/build-set-impact-limitless.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { cardUid, requireSynonymDatabase, type SynonymDatabase } from '../shared/data/cardIdentity';
import { BASIC_ENERGY_NAMES, SET_CATALOG } from '../shared/data/canonicalPrint';
import { createSetImpactBuilder, type RegulationMarks } from '../shared/setImpact/build';
import {
  cutToDepth,
  extendSynonyms,
  isEligible,
  type LimitlessDeck,
  type LimitlessEventInfo,
  parseDecklists,
  parseEventInfo,
  parsePrintTable,
  SUN_MOON_WINDOWS,
  toImpactDecks
} from '../shared/setImpact/limitless';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, '.cache', 'limitless-day2');
const OUT_PATH = join(ROOT, 'static', 'set-impact.json');
const R2_BASE = 'https://r2.ciphermaniac.com';
const LIMITLESS = 'https://limitlesstcg.com';
const FIRST_EVENT = 261;
const LAST_EVENT = 577;
const DEPTH = { depth: 0.05, minDecks: 8, minCoverage: 0.95 };
const HEADERS = { 'User-Agent': 'Mozilla/5.0 ciphermaniac-set-impact (one-off)' };

const DATED_SETS = new Set(SET_CATALOG.filter(entry => entry.legalFrom).map(entry => entry.code));

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

async function fetchText(url: string): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: HEADERS });
    await sleep(1000);
    if (res.ok) {
      return res.text();
    }
    if (res.status === 404) {
      return null;
    }
  }
  throw new Error(`${url}: failed after 3 attempts`);
}

/** Read a cached file, or produce and cache it. */
async function cached<T>(file: string, produce: () => Promise<T>): Promise<T> {
  const path = join(CACHE, file);
  if (existsSync(path)) {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  }
  const value = await produce();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value), 'utf8');
  return value;
}

async function eventInfo(id: number): Promise<LimitlessEventInfo> {
  const html = join(CACHE, 'info', `${id}.html`);
  if (existsSync(html)) {
    return parseEventInfo(id, readFileSync(html, 'utf8'));
  }
  const body = (await fetchText(`${LIMITLESS}/tournaments/${id}`)) ?? '';
  mkdirSync(dirname(html), { recursive: true });
  writeFileSync(html, body, 'utf8');
  return parseEventInfo(id, body);
}

async function eventDecks(id: number): Promise<LimitlessDeck[]> {
  const cachedEvent = await cached(`lists/${id}.json`, async () => ({
    decks: parseDecklists((await fetchText(`${LIMITLESS}/tournaments/${id}/decklists`)) ?? '')
  }));
  return cachedEvent.decks;
}

async function r2Json<T>(path: string): Promise<T> {
  const res = await fetch(`${R2_BASE}${encodeURI(path)}`, { headers: { Origin: 'https://ciphermaniac.com' } });
  if (!res.ok) {
    throw new Error(`${path}: HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

async function loadOurData(): Promise<{ db: SynonymDatabase; marks: RegulationMarks }> {
  const pointer = await r2Json<{ manifest: string }>('/current.json');
  const manifest = await r2Json<{ roots: { assets: string } }>(pointer.manifest);
  const [db, types] = await Promise.all([
    r2Json<SynonymDatabase>(`${manifest.roots.assets}/card-synonyms.json`),
    r2Json<Record<string, { regulationMark?: string | null }>>(`${manifest.roots.assets}/data/card-types.json`)
  ]);
  const marks = Object.fromEntries(Object.entries(types).map(([key, entry]) => [key, entry.regulationMark]));
  return { db: requireSynonymDatabase(db, 'set impact'), marks };
}

interface KeptEvent {
  info: LimitlessEventInfo & { date: string; players: number };
  decks: LimitlessDeck[];
}

async function collectEvents(): Promise<KeptEvent[]> {
  const kept: KeptEvent[] = [];
  const today = new Date().toISOString().slice(0, 10);
  let incomplete = 0;
  for (let id = FIRST_EVENT; id <= LAST_EVENT; id++) {
    const info = await eventInfo(id);
    if (!isEligible(info, code => DATED_SETS.has(code), today)) {
      continue;
    }
    const decks = cutToDepth(await eventDecks(id), info.players as number, DEPTH);
    if (!decks) {
      incomplete++;
      continue;
    }
    kept.push({ info: info as KeptEvent['info'], decks });
  }
  console.log(`[set-impact] ${kept.length} events kept, ${incomplete} left out as incomplete`);
  return kept.sort((a, b) => a.info.date.localeCompare(b.info.date));
}

/** Print tables for every listed card our synonyms don't know. */
async function scrapeUnknownPrints(events: KeptEvent[], db: SynonymDatabase): Promise<Map<string, string[]>> {
  const known = new Set([...Object.keys(db.synonyms), ...Object.values(db.synonyms)]);
  const found = new Map<string, string[]>();
  const covered = new Set<string>();
  const uids = new Set(
    events.flatMap(event =>
      event.decks.flatMap(deck =>
        deck.cards
          .filter(([name]) => !BASIC_ENERGY_NAMES.has(name))
          .map(([name, set, number]) => cardUid(name, set, number))
          .filter((uid): uid is NonNullable<typeof uid> => uid !== null)
      )
    )
  );
  for (const uid of uids) {
    if (known.has(uid) || covered.has(uid)) {
      continue;
    }
    const [name, set, number] = uid.split('::');
    const prints = await cached(`cards/${set}_${number}.json`, async () =>
      parsePrintTable((await fetchText(`${LIMITLESS}/cards/${set}/${number.replace(/^0+(?=\d)/, '')}`)) ?? '')
    );
    prints.forEach(print => covered.add(`${name}::${print}`));
    if (prints.length > 1) {
      found.set(uid, prints);
    }
  }
  console.log(`[set-impact] ${found.size} unknown cards had other printings on Limitless`);
  return found;
}

async function main(): Promise<void> {
  const { db, marks } = await loadOurData();
  const events = await collectEvents();
  const extended = extendSynonyms(db, await scrapeUnknownPrints(events, db));
  const builder = createSetImpactBuilder(extended, marks, SUN_MOON_WINDOWS);
  for (const { info, decks } of events) {
    builder.addEvent({ date: info.date, name: info.name, players: info.players, decks: toImpactDecks(decks) });
  }
  const payload = builder.finish(new Date().toISOString());
  if (payload.sets.length === 0) {
    throw new Error('No sets scored — refusing to overwrite the existing file');
  }
  writeFileSync(OUT_PATH, `${JSON.stringify(payload)}\n`, 'utf8');
  const misses = [...builder.unattributed].sort((a, b) => b[1] - a[1]).slice(0, 10);
  console.log(`[set-impact] Wrote ${payload.sets.length} sets over ${payload.events.length} events to ${OUT_PATH}`);
  if (misses.length) {
    console.warn(`[set-impact] No legal printing for: ${misses.map(([uid]) => uid).join(', ')}`);
  }
}

main().catch((err: unknown) => {
  console.error('[set-impact] Failed', err);
  process.exit(1);
});
