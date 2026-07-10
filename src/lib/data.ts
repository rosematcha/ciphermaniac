/**
 * Thin data layer wrapping the production R2 reports.
 *
 * Hits `https://r2.ciphermaniac.com/reports/...` directly from the browser
 * (CORS allowed). No Functions on the page-render critical path.
 *
 * Solid resources handle their own caching; this module keeps only a small
 * TTL'd dedupe map so parallel calls for the same URL share a single fetch and
 * page-to-page fan-outs (CardPage requests every archetype report) don't
 * re-download within a navigation burst — while a tab left open across the
 * daily data update still picks up fresh reports within minutes.
 */

import { ONLINE_META_LABEL, ONLINE_META_NAME } from './constants';
import type {
  ArchetypeIndexEntry,
  ArchetypeReport,
  CardDistributionEntry,
  CardItem,
  MetaReport,
  PlayerDecks,
  PlayerIndexEntry,
  PlayerIndexSlimEntry,
  PlayerMatchRecord,
  PlayerProfile,
  TournamentParticipant
} from '../types';
import { getCanonicalCardFromData, type SynonymDatabase } from '../../shared/synonyms.js';
import { cardNumberIndexKey, normalizeCardNumber } from '../../shared/cardUtils.js';
import { getSynonymDatabase } from '../utils/cardSynonyms';
import { calculatePercentage } from '../../shared/reportUtils.js';
import type { UpcomingPayload } from '../../shared/upcomingTypes.js';
import type { MajorsTrendsPayload } from './majorsTrends';
import archetypeIconsRaw from '../data/archetype-icons.json';

export type { UpcomingPayload };

const R2_BASE = 'https://r2.ciphermaniac.com';

/**
 * Fetch dedupe/short cache. `expires` is Infinity while the request is in
 * flight, then a short TTL once resolved; rejected entries are removed
 * immediately so a user-triggered retry gets a fresh fetch. Expired entries
 * are swept on insert so multi-MB payloads don't accumulate for the session.
 */
const FETCH_TTL_MS = 5 * 60 * 1000;
const inflight = new Map<string, { promise: Promise<unknown>; expires: number }>();

function cachedFetch(url: string): Promise<unknown> | null {
  const entry = inflight.get(url);
  if (!entry) {
    return null;
  }
  if (Date.now() > entry.expires) {
    inflight.delete(url);
    return null;
  }
  return entry.promise;
}

function rememberFetch(url: string, promise: Promise<unknown>): void {
  const now = Date.now();
  for (const [key, entry] of inflight) {
    if (now > entry.expires) {
      inflight.delete(key);
    }
  }
  const entry = { promise, expires: Infinity };
  inflight.set(url, entry);
  promise.then(
    () => {
      entry.expires = Date.now() + FETCH_TTL_MS;
    },
    () => {
      if (inflight.get(url) === entry) {
        inflight.delete(url);
      }
    }
  );
}

/**
 * Snapshot data (frozen pre-rotation reports) lives at /reports/Snapshots/{date}/.
 * In dev, the build-rotation-snapshots script writes to `static/reports/Snapshots/`
 * so vite serves them at the root; in prod they're on R2 like everything else.
 * We pick the right base per call rather than per-helper so non-snapshot reads
 * keep their fast path.
 */
function shouldUseLocalForPath(path: string): boolean {
  return Boolean(import.meta.env?.DEV) && path.startsWith('/reports/Snapshots/');
}

/**
 * Shared fetch core with dedupe/short-cache. `optional` resolves 404s to null
 * instead of throwing; the two public names below pin the return type so callers
 * keep their non-null / nullable contracts.
 */
async function fetchJsonCore<T>(path: string, optional: boolean): Promise<T | null> {
  const url = shouldUseLocalForPath(path) ? path : `${R2_BASE}${path}`;
  const cached = cachedFetch(url);
  if (cached) {
    return cached as Promise<T | null>;
  }
  const promise = (async () => {
    const response = await fetch(url, { mode: 'cors' });
    if (optional && response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as T;
  })();
  rememberFetch(url, promise);
  return promise;
}

function fetchJson<T>(path: string): Promise<T> {
  return fetchJsonCore<T>(path, false) as Promise<T>;
}

/**
 * Optional variant of fetchJson that resolves to null on 404 rather than throwing.
 */
function fetchJsonOptional<T>(path: string): Promise<T | null> {
  return fetchJsonCore<T>(path, true);
}

// --- Tournament-scoped reports ---

export interface MasterPayload {
  deckTotal: number;
  items: CardItem[];
}

const ONLINE = ONLINE_META_NAME;

/**
 * Sentinel "tournament" key used to point the standard data fetchers at a
 * pre-rotation snapshot. Format: `snapshot:YYYY-MM-DD`. Pages that want to
 * render rotated content pass this through `fetchMaster`/`fetchArchetype`/etc.
 * exactly as they would a normal tournament key, and the path helper rewrites
 * the R2 path to `/reports/Snapshots/{date}/...`.
 */
const SNAPSHOT_SOURCE_PREFIX = 'snapshot:';

export function isSnapshotSource(source: string): boolean {
  return source.startsWith(SNAPSHOT_SOURCE_PREFIX);
}

export function snapshotSourceKey(rotationDate: string): string {
  return `${SNAPSHOT_SOURCE_PREFIX}${rotationDate}`;
}

function tournamentPath(name: string): string {
  if (isSnapshotSource(name)) {
    const date = name.slice(SNAPSHOT_SOURCE_PREFIX.length);
    return `/reports/Snapshots/${encodeURIComponent(date)}`;
  }
  return `/reports/${encodeURIComponent(name)}`;
}

// --- Read-time canonicalization ("symlink" model) ---

/**
 * Normalize a card number for the SPA's `SET::NUMBER` synonym/snapshot index
 * keys. Delegates to the shared helper so the keys the SPA builds can never
 * drift from the ones the index producers write; lowercase-suffixed URLs
 * resolve the same way the edge 301 does.
 */
export function setNumberKey(value: string | number): string {
  return cardNumberIndexKey(value);
}

/**
 * Compute the UID for a card item. Prefers an explicit `uid` field, then
 * `Name::SET::NUMBER`, then bare name as a last resort. The number is
 * zero-padded to the synonym DB's canonical form (e.g. `098`, not `98`) so the
 * fallback UID hits the synonym index consistently.
 */
export function itemUid(item: CardItem): string {
  if (item.uid) {
    return item.uid;
  }
  if (item.set && item.number !== undefined && item.number !== null) {
    const num = normalizeCardNumber(item.number) || String(item.number);
    return `${item.name}::${item.set}::${num}`;
  }
  return item.name;
}

type AnyCardItem = CardItem & {
  deckInstances?: Array<{ deckId: string; count: number; archetype?: string }>;
};

/**
 * Collapse variant printings into their canonical entry. Reports stay
 * immutable on R2; the data layer merges at read time so the page render
 * sees one row per canonical card, regardless of how the per-tournament
 * report was canonicalized when it was originally built.
 *
 * Merges `found`, `dist` buckets (by `copies`), and any `deckInstances`
 * (archetype reports). Recomputes `pct` from `(found / deckTotal) * 100` and
 * each `dist[].percent` from `(players / found) * 100`. Re-sorts by `found`
 * desc and reassigns `rank`.
 *
 * Exported for unit tests.
 */
export function canonicalizeReport<T extends { deckTotal: number; items: AnyCardItem[] }>(
  report: T,
  db: SynonymDatabase | null
): T {
  if (!db || !report?.items?.length) {
    return report;
  }

  const grouped = new Map<string, AnyCardItem>();

  for (const item of report.items) {
    const uid = itemUid(item);
    const canonicalUid = getCanonicalCardFromData(db, uid);
    const canonicalParts = canonicalUid.includes('::') ? canonicalUid.split('::') : null;

    const existing = grouped.get(canonicalUid);
    if (!existing) {
      // First occurrence — clone and stamp with canonical identity. Only
      // rewrite name/set/number when a real synonym mapping applied
      // (canonicalUid !== uid); otherwise keep the item's own display fields so
      // the padded lookup UID doesn't leak into the rendered number.
      const next: AnyCardItem = { ...item, uid: canonicalUid };
      if (canonicalUid !== uid && canonicalParts && canonicalParts.length >= 3) {
        next.name = canonicalParts[0];
        next.set = canonicalParts[1];
        next.number = canonicalParts[2];
      }
      if (item.dist) {
        next.dist = item.dist.map(d => ({ ...d }));
      }
      if (item.deckInstances) {
        next.deckInstances = [...item.deckInstances];
      }
      grouped.set(canonicalUid, next);
      continue;
    }

    // Merge variant into existing canonical entry.
    existing.found = (existing.found ?? 0) + (item.found ?? 0);

    const distMap = new Map<number, CardDistributionEntry>();
    for (const d of existing.dist ?? []) {
      if (d.copies === undefined) {
        continue;
      }
      distMap.set(d.copies, { ...d });
    }
    for (const d of item.dist ?? []) {
      if (d.copies === undefined) {
        continue;
      }
      const prev = distMap.get(d.copies);
      if (prev) {
        prev.players = (prev.players ?? 0) + (d.players ?? 0);
      } else {
        distMap.set(d.copies, { ...d });
      }
    }
    existing.dist = Array.from(distMap.values()).sort((a, b) => (a.copies ?? 0) - (b.copies ?? 0));

    if (item.deckInstances?.length) {
      existing.deckInstances = [...(existing.deckInstances ?? []), ...item.deckInstances];
    }
  }

  // Recompute derived stats now that variants are merged.
  for (const item of grouped.values()) {
    // A deck that ran two variant printings of one canonical card is counted in
    // each variant row's `found`, so naively summing double-counts it (pct can
    // exceed 100%). When per-deck identity is available (archetype reports carry
    // `deckInstances`), dedupe by deckId and recompute `found` from the distinct
    // decks. Otherwise (pre-aggregated master rows without deckIds) the overlap
    // can't be recovered, so clamp `found` to the deck total as a floor defense.
    if (item.deckInstances?.length) {
      const seen = new Set<string>();
      const deduped: Array<{ deckId: string; count: number; archetype?: string }> = [];
      for (const inst of item.deckInstances) {
        const id = inst?.deckId;
        if (id) {
          if (seen.has(id)) {
            continue;
          }
          seen.add(id);
        }
        deduped.push(inst);
      }
      if (deduped.length !== item.deckInstances.length) {
        item.deckInstances = deduped;
        item.found = deduped.length;
      }
    }
    if (item.found !== undefined && item.found > report.deckTotal) {
      // A producer double-counted a canonical card. Clamp so the UI stays
      // sane, but say so — silently rendering 100% would hide the regression.
      console.warn(
        `[canonicalizeReport] found (${item.found}) exceeds deckTotal (${report.deckTotal}) for ${item.uid ?? item.name}; clamping`
      );
      item.found = report.deckTotal;
    }
    item.pct = calculatePercentage(item.found ?? 0, report.deckTotal);
    if (item.dist) {
      for (const d of item.dist) {
        d.percent = calculatePercentage(d.players ?? 0, item.found ?? 0);
      }
    }
  }

  const sorted = Array.from(grouped.values()).sort((a, b) => (b.found ?? 0) - (a.found ?? 0));
  sorted.forEach((item, idx) => {
    item.rank = idx + 1;
  });

  return { ...report, items: sorted };
}

/**
 * Canonicalize the `cardTrends` portion of the trends payload. Updates each
 * entry's identifying fields (`key`, `set`, `number`, `name`) to canonical
 * and dedupes by canonical key (keeping the entry with higher `appearances`).
 *
 * Time-series shares are NOT re-aggregated; the trend file was built with
 * canonicalized aggregates at generation time, so the entry we keep already
 * represents the merged time series for that card.
 */
function canonicalizeCardTrendEntries(entries: CardTrendEntry[], db: SynonymDatabase): CardTrendEntry[] {
  const grouped = new Map<string, CardTrendEntry>();
  for (const entry of entries) {
    const canonicalKey = getCanonicalCardFromData(db, entry.key);
    const canonicalParts = canonicalKey.includes('::') ? canonicalKey.split('::') : null;
    const next: CardTrendEntry = { ...entry, key: canonicalKey };
    if (canonicalParts && canonicalParts.length >= 3) {
      next.name = canonicalParts[0];
      next.set = canonicalParts[1];
      next.number = canonicalParts[2];
    }
    const prev = grouped.get(canonicalKey);
    if (!prev || (next.appearances ?? 0) > (prev.appearances ?? 0)) {
      grouped.set(canonicalKey, next);
    }
  }
  return Array.from(grouped.values());
}

/**
 * Tournament list. Sorted by R2 already (recent first). Includes `ONLINE_META_NAME`
 * as the first entry in our wrapper, so the selector always offers the rolling meta.
 */
export async function fetchTournamentsList(): Promise<string[]> {
  const list = await fetchJson<string[]>('/reports/tournaments.json');
  // Make sure online meta is first if not already in the list.
  if (!list.includes(ONLINE)) {
    return [ONLINE, ...list];
  }
  return list;
}

export function fetchMeta(tournament: string = ONLINE): Promise<MetaReport> {
  return fetchJson<MetaReport>(`${tournamentPath(tournament)}/meta.json`);
}

/**
 * Maps `"SET::NUMBER"` → the lowercase name of the Pokémon this card evolves from.
 * Sourced from the same `card-types.json` the workers use to enrich decks; loaded
 * once per session. Returns an empty map if the asset can't be fetched (callers
 * should treat evolution data as optional decoration, not load-bearing).
 */
let evolutionMapPromise: Promise<Map<string, string>> | null = null;
export function fetchEvolutionMap(): Promise<Map<string, string>> {
  if (evolutionMapPromise) {
    return evolutionMapPromise;
  }
  // Don't cache failures forever — a transient network blip shouldn't
  // permanently disable evolution collapsing for the session, so the pinned
  // promise is dropped before resolving the fallback empty map.
  evolutionMapPromise = (async () => {
    try {
      // Prefer the slim precomputed map (~20KB vs the 700KB full database);
      // fall back to deriving it from card-types.json until the pipeline has
      // published the slim artifact for the first time.
      const slim = await fetch(`${R2_BASE}/assets/data/evolves-from.json`, { mode: 'cors' });
      if (slim.ok) {
        const entries = (await slim.json()) as Record<string, string>;
        return new Map<string, string>(Object.entries(entries));
      }
      const response = await fetch(`${R2_BASE}/assets/data/card-types.json`, { mode: 'cors' });
      if (!response.ok) {
        evolutionMapPromise = null;
        return new Map<string, string>();
      }
      const db = (await response.json()) as Record<string, { evolutionInfo?: string }>;
      const map = new Map<string, string>();
      for (const [key, info] of Object.entries(db)) {
        const parent = parseEvolvesFrom(info?.evolutionInfo);
        if (parent) {
          map.set(key, parent.toLowerCase());
        }
      }
      return map;
    } catch {
      evolutionMapPromise = null;
      return new Map<string, string>();
    }
  })();
  return evolutionMapPromise;
}

function parseEvolvesFrom(info: string | undefined): string | null {
  if (!info) {
    return null;
  }
  const m = info.match(/Evolves from\s+(.+?)\s*$/i);
  if (!m) {
    return null;
  }
  return decodeHtmlEntities(m[1]).trim();
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
};
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => NAMED_ENTITIES[name] ?? m);
}

/**
 * Canonicalization is a full group/merge/re-sort over every item, and CardPage
 * fans `fetchArchetype` out over every archetype — so cache the result per raw
 * payload object (payloads are shared within the fetch TTL window) instead of
 * redoing the merge on every call.
 */
const canonicalizedReports = new WeakMap<object, unknown>();

function canonicalizeReportCached<T extends { deckTotal: number; items: AnyCardItem[] }>(
  raw: T,
  db: SynonymDatabase | null
): T {
  if (!db || !raw?.items?.length) {
    return raw;
  }
  const hit = canonicalizedReports.get(raw);
  if (hit) {
    return hit as T;
  }
  const out = canonicalizeReport(raw, db);
  canonicalizedReports.set(raw, out);
  return out;
}

export async function fetchMaster(tournament: string = ONLINE): Promise<MasterPayload> {
  const [raw, db] = await Promise.all([
    fetchJson<MasterPayload>(`${tournamentPath(tournament)}/master.json`),
    getSynonymDatabase()
  ]);
  return canonicalizeReportCached(raw, db);
}

/**
 * Archetype index files mix percent scales: indexes ingested before commit
 * 3939e71 store 0–100, newer ones store a 0–1 fraction. A per-value guess
 * (≤ 1 ⇒ fraction) misreads sub-1% archetypes in old files as ~90% shares
 * (e.g. Birmingham's 0.90% Sharpedo Toxtricity rendering as 89.7%), so decide
 * the scale once per file: any value above 1 means the file is already 0–100.
 */
function normalizeIndexPercentScale(list: ArchetypeIndexEntry[]): ArchetypeIndexEntry[] {
  let max = 0;
  for (const entry of list) {
    if (typeof entry.percent === 'number' && entry.percent > max) {
      max = entry.percent;
    }
  }
  if (max === 0 || max > 1) {
    return list;
  }
  return list.map(entry => (typeof entry.percent === 'number' ? { ...entry, percent: entry.percent * 100 } : entry));
}

export async function fetchArchetypes(tournament: string = ONLINE): Promise<ArchetypeIndexEntry[]> {
  const list = await fetchJson<ArchetypeIndexEntry[]>(`${tournamentPath(tournament)}/archetypes/index.json`);
  return normalizeIndexPercentScale(list);
}

/**
 * Normalizes an archetype name/label to the key form used by the icon override
 * map. Mirrors `normalize_deck_label` in download-tournament.py so the same key
 * matches both archetype `label`/`name` and trends `series.name` (the base slug,
 * e.g. "Dragapult Dusknoir" → "dragapult_dusknoir").
 */
export function normalizeArchetypeKey(name: string | null | undefined): string {
  return String(name ?? '')
    .replace(/['’]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

/**
 * Archetype → representative Pokémon icon slugs (the hand-maintained override map
 * committed at `src/data/archetype-icons.json`, regenerated by
 * `.github/scripts/scrape-archetype-icons.py`). The same file is the override
 * source the Python pipeline reads, so frontend and pipeline never drift.
 *
 * It's bundled as a static JSON import rather than fetched: the repo's runtime
 * data dir (`static/`, the Vite publicDir) is gitignored/CI-populated, so a
 * same-origin fetch wouldn't resolve in dev. Bundling keeps it in lock-step with
 * the commit and needs no network or R2 round-trip (~5KB).
 */
const ARCHETYPE_ICON_MAP: Map<string, string[]> = (() => {
  const map = new Map<string, string[]>();
  for (const [label, slugs] of Object.entries(archetypeIconsRaw as Record<string, string[]>)) {
    if (Array.isArray(slugs) && slugs.length > 0) {
      map.set(normalizeArchetypeKey(label), slugs);
    }
  }
  return map;
})();

/** The archetype → Pokémon icon-slug map, keyed by normalized archetype name. */
export function getArchetypeIconMap(): Map<string, string[]> {
  return ARCHETYPE_ICON_MAP;
}

/**
 * Resolves an archetype's icon slugs: prefer the entry's embedded `icons` (from
 * the tournament index), else fall back to the override map by normalized
 * label/name so icons appear retroactively on tournaments that predate the field.
 */
export function resolveArchetypeIcons(
  identifiers: { name?: string | null; label?: string | null; icons?: string[] },
  map?: Map<string, string[]> | null
): string[] {
  if (identifiers.icons && identifiers.icons.length > 0) {
    return identifiers.icons;
  }
  if (!map) {
    return [];
  }
  return map.get(normalizeArchetypeKey(identifiers.label)) ?? map.get(normalizeArchetypeKey(identifiers.name)) ?? [];
}

export async function fetchArchetype(tournament: string, archetypeBase: string): Promise<ArchetypeReport> {
  const [raw, db] = await Promise.all([
    fetchJson<ArchetypeReport>(
      `${tournamentPath(tournament)}/archetypes/${encodeURIComponent(archetypeBase)}/cards.json`
    ),
    getSynonymDatabase()
  ]);
  return canonicalizeReportCached(raw, db);
}

// Backwards-compatible alias (always online meta)
export const fetchOnlineArchetypes = (): Promise<ArchetypeIndexEntry[]> => fetchArchetypes(ONLINE);

/** One archetype's usage of a card, from the precomputed `cardUsage.json` index. */
export interface CardUsageEntry {
  /** Archetype slug — joins to archetypes/index.json `name` for label/icons/deckCount. */
  slug: string;
  found: number;
  pct: number;
  dist: CardDistributionEntry[];
}

/**
 * Build-time inverted index (`cardUsage.json`): canonical card UID → every
 * archetype that plays it. Lets CardPage load one small file instead of fanning
 * a fetch out to every archetype's cards.json. Absent for tournaments/snapshots
 * generated before the file existed — callers fall back to the per-archetype
 * fan-out.
 */
export interface CardUsagePayload {
  usage: Record<string, CardUsageEntry[]>;
}

export function fetchCardUsage(tournament: string): Promise<CardUsagePayload | null> {
  return fetchJsonOptional<CardUsagePayload>(`${tournamentPath(tournament)}/cardUsage.json`);
}

/**
 * Look up a card's per-archetype usage in a `cardUsage.json` payload. Tries the
 * card's canonical UID first, then a set+number normalized scan across the index
 * keys (defensive: the card came from the canonicalized master, so a direct UID
 * hit is the norm). Returns null if the card isn't in the index.
 */
export function cardUsageForCard(payload: CardUsagePayload, card: CardItem): CardUsageEntry[] | null {
  const direct = payload.usage[itemUid(card)];
  if (direct) {
    return direct;
  }
  if (card.set && card.number != null) {
    const setU = card.set.toUpperCase();
    const numKey = normalizeCardNumberKey(String(card.number));
    for (const [uid, entries] of Object.entries(payload.usage)) {
      const parts = uid.split('::');
      if (parts.length >= 3 && parts[1].toUpperCase() === setU && normalizeCardNumberKey(parts[2]) === numKey) {
        return entries;
      }
    }
  }
  return null;
}

// --- Rotation snapshots ---

/**
 * Maps rotated cards and archetypes to the snapshot containing them. Built by
 * scripts/build-rotation-snapshots.ts. See functions/lib/onlineMeta/snapshotIndexBuilder.ts
 * for the schema and the "canonical wins" exclusion rule.
 */
export interface SnapshotIndex {
  generatedAt: string;
  rotations: { date: string; label?: string; snapshotPath: string }[];
  /** Canonical card UID (Name::SET::NUMBER) → rotation date */
  cards: Record<string, string>;
  /** SET::NUMBER (uppercase, leading zeros stripped) → rotation date */
  cardsBySetNumber: Record<string, string>;
  /** Archetype slug → rotation date */
  archetypes: Record<string, string>;
}

let snapshotIndexPromise: Promise<SnapshotIndex | null> | null = null;

/**
 * Lazy fetch + module-level cache for the rotation index. Used by CardPage and
 * ArchetypePage to decide whether a missing card/archetype has a snapshot to
 * fall back to. Returns null if the index hasn't been generated yet (e.g. in
 * dev before running the snapshot script) so the fallback gracefully no-ops.
 *
 * Only successful resolutions are cached: a transient network failure must not
 * permanently disable the fallback for the lifetime of the page.
 */
export function fetchRotationIndex(): Promise<SnapshotIndex | null> {
  if (!snapshotIndexPromise) {
    const attempt = fetchJsonOptional<SnapshotIndex>('/reports/Snapshots/index.json').catch(() => null);
    snapshotIndexPromise = attempt;
    attempt.then(value => {
      if (value === null) {
        // Treat "no snapshot index yet" as a soft miss but don't pin a null
        // forever — let later page navs retry in case the file appears.
        snapshotIndexPromise = null;
      }
    });
  }
  return snapshotIndexPromise;
}

/**
 * Look up the rotation date for a card by its URL set/number. The URL set is
 * case-insensitive and the number may carry leading zeros — normalize both
 * before checking against the index's `SET::NUMBER` key.
 */
export function snapshotDateForCard(index: SnapshotIndex | null, set: string, number: string): string | null {
  if (!index) {
    return null;
  }
  const setU = set.toUpperCase();
  const numTrim = setNumberKey(number);
  return index.cardsBySetNumber[`${setU}::${numTrim}`] ?? null;
}

export function snapshotDateForArchetype(index: SnapshotIndex | null, slug: string): string | null {
  if (!index) {
    return null;
  }
  return index.archetypes[slug] ?? null;
}

// --- Player data (per-tournament only) ---

export function fetchParticipants(tournament: string): Promise<TournamentParticipant[] | null> {
  return fetchJsonOptional<TournamentParticipant[]>(`${tournamentPath(tournament)}/players.json`);
}

interface DeckCardRecord {
  count: number;
  name: string;
  set?: string;
  number?: string;
  category?: string;
  evolutionInfo?: string;
  fullType?: string;
}
export interface DeckRecord {
  id: string;
  deckId: string;
  player: string;
  playerId: string;
  country?: string;
  placement?: number;
  archetype: string;
  archetypeId: string;
  cards: DeckCardRecord[];
  /** Whether this deck's pilot made the Day 2 cut (Phase 2). */
  madePhase2?: boolean;
}

function fetchDecks(tournament: string): Promise<DeckRecord[] | null> {
  return fetchJsonOptional<DeckRecord[]>(`${tournamentPath(tournament)}/decks.json`);
}

export interface Day2CardStat {
  uid: string;
  name: string;
  set: string;
  number: string;
  /** Decks playing this card on Day 1 */
  day1Count: number;
  /** Of those, how many were piloted by a player who made Day 2 */
  day2Count: number;
  /** day2Count / day1Count * 100 */
  conversion: number;
}

/**
 * Precomputed Day 1 → Day 2 conversion counts for one tournament
 * (`conversion.json`, built by the pipeline). Keyed by canonical card UID so it
 * lines up with master.json. Absent for events ingested before the file existed
 * (callers fall back to computing from decks.json).
 */
export interface ConversionPayload {
  day1Total: number;
  day2Total: number;
  cards: Record<string, { day1: number; day2: number }>;
}

export function fetchConversionIndex(tournament: string): Promise<ConversionPayload | null> {
  return fetchJsonOptional<ConversionPayload>(`${tournamentPath(tournament)}/conversion.json`);
}

/** Map canonical UID → display name/set/number from the (canonicalized) master report. */
function buildDisplayMap(master: MasterPayload): Map<string, { name: string; set: string; number: string }> {
  const display = new Map<string, { name: string; set: string; number: string }>();
  for (const item of master.items) {
    display.set(itemUid(item), {
      name: item.name,
      set: item.set ?? '',
      number: String(item.number ?? '')
    });
  }
  return display;
}

/** Resolve display fields for a UID, falling back to parsing `Name::SET::NUMBER`. */
function displayForUid(
  uid: string,
  display: Map<string, { name: string; set: string; number: string }>
): { name: string; set: string; number: string } | null {
  const hit = display.get(uid);
  if (hit) {
    return hit;
  }
  const parts = uid.split('::');
  if (parts.length < 3) {
    return null;
  }
  return { name: parts[0], set: parts[1], number: parts[2] };
}

/**
 * Compute per-card Day 1 → Day 2 conversion for a single tournament.
 *
 * Fast path: the pipeline precomputes `conversion.json` (per-UID day1/day2
 * counts) so we avoid downloading the multi-MB decks.json. Falls back to the
 * decks-based computation for events generated before that file existed (404).
 * Returns null when the tournament has no Day 2 cut — Online Meta in particular
 * has no single cut, so callers should not invoke this for that key.
 */
export async function fetchDay2CardStats(tournament: string): Promise<Day2CardStat[] | null> {
  const conversion = await fetchConversionIndex(tournament);
  if (conversion) {
    return day2CardStatsFromConversion(conversion, tournament);
  }
  return day2CardStatsFromDecks(tournament);
}

async function day2CardStatsFromConversion(
  conversion: ConversionPayload,
  tournament: string
): Promise<Day2CardStat[] | null> {
  if (conversion.day2Total === 0) {
    return null;
  }
  const entries = Object.entries(conversion.cards);
  if (entries.length === 0) {
    return null;
  }
  const master = await fetchMaster(tournament);
  const display = buildDisplayMap(master);
  const out: Day2CardStat[] = [];
  for (const [uid, c] of entries) {
    const d = displayForUid(uid, display);
    if (!d) {
      continue;
    }
    out.push({
      uid,
      name: d.name,
      set: d.set,
      number: d.number,
      day1Count: c.day1,
      day2Count: c.day2,
      conversion: c.day1 > 0 ? (c.day2 / c.day1) * 100 : 0
    });
  }
  return out;
}

async function day2CardStatsFromDecks(tournament: string): Promise<Day2CardStat[] | null> {
  const [decks, master, db] = await Promise.all([
    fetchDecks(tournament),
    fetchMaster(tournament),
    getSynonymDatabase()
  ]);
  if (!decks || decks.length === 0) {
    return null;
  }
  // If no deck claims madePhase2, the tournament probably never reached a cut
  // (or the flag isn't populated yet) — nothing meaningful to render.
  if (!decks.some(d => d.madePhase2)) {
    return null;
  }

  // master.json items are already canonicalized — use them as the source of
  // truth for display name/set/number so the graphic matches the rest of the
  // site.
  const display = buildDisplayMap(master);

  const counts = new Map<string, { day1: number; day2: number }>();
  for (const deck of decks) {
    const isDay2 = deck.madePhase2 === true;
    const seenInDeck = new Set<string>();
    for (const card of deck.cards) {
      if (!card.set || card.number === undefined || card.number === null || card.number === '') {
        continue;
      }
      const rawUid = `${card.name}::${card.set}::${card.number}`;
      const uid = db ? getCanonicalCardFromData(db, rawUid) : rawUid;
      // A deck listing the same canonical card under two variant printings
      // should still only count once toward inclusion.
      if (seenInDeck.has(uid)) {
        continue;
      }
      seenInDeck.add(uid);
      let entry = counts.get(uid);
      if (!entry) {
        entry = { day1: 0, day2: 0 };
        counts.set(uid, entry);
      }
      entry.day1 += 1;
      if (isDay2) {
        entry.day2 += 1;
      }
    }
  }

  const out: Day2CardStat[] = [];
  for (const [uid, c] of counts) {
    // Card present in decks but not in master (rare — typically dropped by
    // canonicalization) falls back to parsing the UID.
    const d = displayForUid(uid, display);
    if (!d) {
      continue;
    }
    out.push({
      uid,
      name: d.name,
      set: d.set,
      number: d.number,
      day1Count: c.day1,
      day2Count: c.day2,
      conversion: c.day1 > 0 ? (c.day2 / c.day1) * 100 : 0
    });
  }
  return out;
}

/**
 * Per-archetype deck list. Used by the Advanced filter builder so the
 * full tournament `decks.json` (much larger) doesn't have to be paid for.
 */
export function fetchArchetypeDecks(tournament: string, archetypeBase: string): Promise<DeckRecord[] | null> {
  return fetchJsonOptional<DeckRecord[]>(
    `${tournamentPath(tournament)}/archetypes/${encodeURIComponent(archetypeBase)}/decks.json`
  );
}

// --- Matchups (per-tournament) ---

// 'phaseWeighted' is no longer generated (the frontend only ever read
// qualityWeighted with fallback to 'all'), but it's kept in the union so old
// matchupProfiles.json files that still have it continue to parse.
type MatchupWeighting = 'all' | 'phaseWeighted' | 'qualityWeighted';

/**
 * One archetype-vs-archetype cell from `matchupProfiles.json`. `archetypeA`/`archetypeB`
 * are display labels (e.g. "Dragapult Dusknoir"), sorted alphabetically, so a given
 * archetype can appear on either side. Ties are folded into `winsA`/`winsB` as 0.5
 * each (so for a pair with no double-losses, `winsA + winsB === matches`). Recover the
 * raw record with `rawWinsA = winsA - ties/2`. `doubleLosses` count toward `matches`
 * but toward neither side's wins.
 */
export interface MatchupPair {
  archetypeA: string;
  archetypeB: string;
  matches: number;
  winsA: number;
  winsB: number;
  ties: number;
  doubleLosses: number;
  weightedWinsA: number;
  weightedWinsB: number;
  weightedTies: number;
  weightedWinRateA: number;
  weightedWinRateB: number;
  weightedMatches: number;
}

export interface MatchupProfile {
  name: MatchupWeighting;
  matchesConsidered: number;
  weightedMatches: number;
  byArchetypePair: MatchupPair[];
}

export interface MatchupProfilesPayload {
  generatedAt: string;
  tournament: { id: string; labsCode?: string; name: string; players: number; division?: string };
  phaseMultipliers: Record<string, number>;
  qualityModel: Record<string, unknown>;
  // Partial: new files omit 'phaseWeighted'; old files may still have it.
  profiles: Partial<Record<MatchupWeighting, MatchupProfile>>;
}

/**
 * Pre-aggregated archetype-vs-archetype matrix for a single event. Generated by
 * `aggregate_matchups()` in `.github/scripts/download-tournament.py` and stored at
 * `{tournament}/matchupProfiles.json`. Present for major events only; returns null
 * for the online meta, snapshots, and any scope without the file so callers degrade
 * gracefully (use `fetchArchetypeMatchupsOnline` for the online scope).
 */
export function fetchMatchupProfiles(tournament: string): Promise<MatchupProfilesPayload | null> {
  return fetchJsonOptional<MatchupProfilesPayload>(`${tournamentPath(tournament)}/matchupProfiles.json`);
}

/**
 * One opponent's head-to-head record as stored in the online meta. Unlike the
 * majors file, `winRate` here is `wins / total` (ties excluded from the numerator,
 * included in the denominator) — recompute as `(wins + ties/2)/total` if you want
 * the ties-as-half convention the majors file uses.
 */
export interface OnlineMatchupRecord {
  opponent: string;
  wins: number;
  losses: number;
  ties: number;
  total: number;
  winRate: number;
}

interface ArchetypeTrendsPayload {
  matchups?: Record<string, OnlineMatchupRecord>;
}

/**
 * Online-meta matchups. The online pipeline doesn't emit `matchupProfiles.json`;
 * it embeds a `matchups` map (opponent label → record) inside each archetype's
 * `trends.json` (built by `generateArchetypeTrends` → `buildMatchupMatrix`). Returns
 * null if the archetype has no trends file or no matchups.
 */
export async function fetchArchetypeMatchupsOnline(
  tournament: string,
  archetypeBase: string
): Promise<Record<string, OnlineMatchupRecord> | null> {
  const trends = await fetchJsonOptional<ArchetypeTrendsPayload>(
    `${tournamentPath(tournament)}/archetypes/${encodeURIComponent(archetypeBase)}/trends.json`
  );
  return trends?.matchups ?? null;
}

/**
 * Every player's every round for one event (`playerMatches.json`). `playerId` is the
 * tournament-scoped id (= `tpId` in players.json, = the id in labs URLs), which joins
 * to `DeckRecord.playerId` (a string — coerce). Used by the card-impact analyzer.
 *
 * The file is ~7MB, so it's cached per tournament for the page session: the
 * dedupe in `fetchJson*` only holds entries for a short TTL, which would
 * re-download on each tool open without this cache.
 */
const playerMatchesCache = new Map<string, Promise<PlayerMatchRecord[] | null>>();

export function fetchPlayerMatches(tournament: string): Promise<PlayerMatchRecord[] | null> {
  const cached = playerMatchesCache.get(tournament);
  if (cached) {
    return cached;
  }
  const promise = fetchJsonOptional<PlayerMatchRecord[]>(`${tournamentPath(tournament)}/playerMatches.json`).catch(
    () => {
      // Don't pin a rejected promise — let a later open retry the download.
      playerMatchesCache.delete(tournament);
      return null;
    }
  );
  playerMatchesCache.set(tournament, promise);
  return promise;
}

/**
 * Per-archetype slice of `playerMatches.json`: only the round records whose pilot
 * belongs to `archetypeBase`, in the same {@link PlayerMatchRecord} shape. This is
 * what the card lens actually needs, and it's a few KB per deck instead of the
 * whole ~7MB event file. Returns null (404) for tournaments ingested before this
 * file existed — callers fall back to {@link fetchPlayerMatches}.
 */
const archetypeMatchesCache = new Map<string, Promise<PlayerMatchRecord[] | null>>();

export function fetchArchetypeMatches(tournament: string, archetypeBase: string): Promise<PlayerMatchRecord[] | null> {
  const cacheKey = `${tournament}::${archetypeBase}`;
  const cached = archetypeMatchesCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const promise = fetchJsonOptional<PlayerMatchRecord[]>(
    `${tournamentPath(tournament)}/archetypes/${encodeURIComponent(archetypeBase)}/matches.json`
  ).catch(() => {
    // Don't pin a rejected promise — let a later open retry the download.
    archetypeMatchesCache.delete(cacheKey);
    return null;
  });
  archetypeMatchesCache.set(cacheKey, promise);
  return promise;
}

// --- Cross-tournament player profiles ---

// In dev, serve from the local public/ tree (populated by
// `npx tsx scripts/build-players-local.ts`) so we don't need a deploy.
async function fetchPlayerJson<T>(path: string): Promise<T | null> {
  if (import.meta.env.DEV) {
    const res = await fetch(path);
    if (res.status === 404) {
      return null;
    }
    if (!res.ok) {
      throw new Error(`Failed to fetch ${path}: ${res.status}`);
    }
    return (await res.json()) as T;
  }
  return fetchJsonOptional<T>(path);
}

export function fetchPlayerIndex(): Promise<PlayerIndexEntry[] | null> {
  return fetchPlayerJson<PlayerIndexEntry[]>('/players/index.json');
}

/**
 * Slim index (players table + compare autocomplete). Roughly 20% smaller raw
 * than the full index — it drops `lastEventDate`. Falls back to the full index
 * when `index-slim.json` 404s so the frontend keeps working if it deploys ahead
 * of the aggregator that first writes the slim file. The full entry is a
 * superset of the slim shape, so it's returned as-is.
 */
export async function fetchPlayerIndexSlim(): Promise<PlayerIndexSlimEntry[] | null> {
  const slim = await fetchPlayerJson<PlayerIndexSlimEntry[]>('/players/index-slim.json');
  if (slim) {
    return slim;
  }
  return fetchPlayerJson<PlayerIndexEntry[]>('/players/index.json');
}

export function fetchPlayerProfile(playerId: string): Promise<PlayerProfile | null> {
  return fetchPlayerJson<PlayerProfile>(`/players/${encodeURIComponent(playerId)}/profile.json`);
}

/**
 * Lazy-fetch decklists for a player. The profile page only requests this when
 * a tournament row is expanded, so most profile views never download it.
 */
export function fetchPlayerDecks(playerId: string): Promise<PlayerDecks | null> {
  return fetchPlayerJson<PlayerDecks>(`/players/${encodeURIComponent(playerId)}/decks.json`);
}

// --- Pricing ---

export interface PricingEntry {
  price?: number;
  tcgPlayerId?: string;
}
interface PricingPayload {
  /** Map of `Name::SET::NUMBER` → entry */
  cardPrices: Record<string, PricingEntry>;
}

/**
 * Returns a flat map of `Name::SET::NUMBER` → { price, tcgPlayerId }.
 */
export async function fetchPrices(): Promise<Record<string, PricingEntry>> {
  const payload = await fetchJsonOptional<PricingPayload>('/reports/prices.json');
  return payload?.cardPrices ?? {};
}

/** One dated price observation from the rolling history. */
export interface PricePoint {
  /** YYYY-MM-DD */
  date: string;
  /** Market price in USD on that date. */
  price: number;
}

/**
 * Rolling price history keyed by `Name::SET::NUMBER`. Written daily by
 * `.github/scripts/update-prices.py`, bounded to a 90-day window, with flat
 * runs collapsed to a single point (so a card whose price never moved carries
 * one point and callers degrade it to nothing). Stored compactly as `{d, p}`;
 * expanded here to `{date, price}`. Absent (null → {}) until the pipeline has
 * run at least once.
 */
interface PriceHistoryPayload {
  history: Record<string, { d: string; p: number }[]>;
}

export async function fetchPriceHistory(): Promise<Record<string, PricePoint[]>> {
  const payload = await fetchJsonOptional<PriceHistoryPayload>('/reports/prices-history.json');
  const raw = payload?.history;
  if (!raw) {
    return {};
  }
  const out: Record<string, PricePoint[]> = {};
  for (const [uid, points] of Object.entries(raw)) {
    out[uid] = points.map(pt => ({ date: pt.d, price: pt.p }));
  }
  return out;
}

/**
 * Minimum calendar span the rolling price history must cover before any
 * price-trend UI is surfaced. The artifact accumulates one day at a time from
 * the daily pipeline (no backfill), so trends are withheld until enough has
 * been collected to be meaningful.
 */
export const PRICE_HISTORY_MIN_DAYS = 30;

/**
 * Days spanned by the whole rolling history (latest observation − earliest,
 * across every card). Flat runs collapse to a single point, so the earliest
 * date across volatile cards is the best proxy for when accumulation began.
 * Gate price UIs on this being ≥ {@link PRICE_HISTORY_MIN_DAYS}.
 */
export function priceHistorySpanDays(history: Record<string, PricePoint[]>): number {
  let min = Infinity;
  let max = -Infinity;
  for (const points of Object.values(history)) {
    for (const pt of points) {
      const t = Date.parse(pt.date);
      if (Number.isNaN(t)) {
        continue;
      }
      if (t < min) {
        min = t;
      }
      if (t > max) {
        max = t;
      }
    }
  }
  if (min === Infinity) {
    return 0;
  }
  return Math.round((max - min) / 86_400_000);
}

// --- Card lookup helpers ---

/**
 * Find a card in the master report by its set + number identifier.
 * Set comparison is case-insensitive. Number comparison normalizes leading zeros
 * (so PAL/185 matches PAL/0185 etc.).
 *
 * Note: items in the returned list carry canonical set/number (the data layer
 * canonicalizes at read time — see `canonicalizeReport`), so a non-canonical
 * (reprint) set/number will not be found here. Callers wanting to handle
 * non-canonical URLs should resolve via `resolveCanonicalSetNumber` first, or
 * rely on the edge redirect in `functions/cards/[set]/[number].ts`.
 */
export function findCardBySetNumber(items: CardItem[], set: string, number: string): CardItem | undefined {
  const setU = set.toUpperCase();
  const targetKey = normalizeCardNumberKey(number);
  return items.find(item => {
    if (!item.set || item.set.toUpperCase() !== setU) {
      return false;
    }
    if (!item.number) {
      return false;
    }
    return normalizeCardNumberKey(String(item.number)) === targetKey;
  });
}

/**
 * Normalize a card number so reprints with leading zeros (PAL/185 vs PAL/0185)
 * collapse, but promo-suffixed variants (PAL/185 vs PAL/185a) do NOT. Splits
 * the number into a digit prefix and an alphabetic suffix; strips leading zeros
 * from the digit prefix only.
 */
export function normalizeCardNumberKey(raw: string): string {
  const upper = raw.toUpperCase();
  const match = upper.match(/^(\d+)(.*)$/);
  if (!match) {
    return upper;
  }
  const digits = match[1].replace(/^0+/, '') || '0';
  return `${digits}${match[2]}`;
}

/**
 * Resolve a (set, number) to its canonical (set, number) via the synonym DB.
 * Returns null if the input pair has no canonical mapping (i.e. it's already
 * canonical or unknown). Used by CardPage to redirect non-canonical URLs.
 */
export async function resolveCanonicalSetNumber(
  set: string,
  number: string
): Promise<{ set: string; number: string } | null> {
  const db = await getSynonymDatabase();
  if (!db || !db.synonyms) {
    return null;
  }
  const index = getSetNumberCanonicalIndex(db);
  const key = `${set.toUpperCase()}::${setNumberKey(number)}`;
  const canonical = index.get(key);
  if (!canonical || canonical.key === key) {
    return null;
  }
  return { set: canonical.set, number: canonical.number };
}

// (set,number) → canonical pair index. Built lazily once per synonym DB load
// so we don't re-scan db.synonyms (~thousands of entries) on every cold card view.
const setNumberIndexCache = new WeakMap<object, Map<string, { key: string; set: string; number: string }>>();

function getSetNumberCanonicalIndex(db: { synonyms: Record<string, string> }) {
  const cached = setNumberIndexCache.get(db);
  if (cached) {
    return cached;
  }
  const index = new Map<string, { key: string; set: string; number: string }>();
  for (const [variantUid, canonicalUid] of Object.entries(db.synonyms)) {
    const parts = variantUid.split('::');
    if (parts.length < 3) {
      continue;
    }
    const vSet = parts[1].toUpperCase();
    const vNum = setNumberKey(parts[2]);
    const cParts = canonicalUid.split('::');
    if (cParts.length < 3) {
      continue;
    }
    const cKey = `${cParts[1].toUpperCase()}::${setNumberKey(cParts[2])}`;
    index.set(`${vSet}::${vNum}`, { key: cKey, set: cParts[1], number: cParts[2] });
  }
  setNumberIndexCache.set(db, index);
  return index;
}

// --- Tournament name helpers ---

/**
 * Tournament keys look like "2026-05-08, Regional Championship Los Angeles".
 * Pretty form for display: "Regional Championship Los Angeles · May 8, 2026"
 * Returns the input unchanged if the format doesn't match.
 */
export function prettyTournamentName(key: string): string {
  if (key === ONLINE) {
    return ONLINE_META_LABEL;
  }
  const m = key.match(/^(\d{4})-(\d{2})-(\d{2}),\s*(.+)$/);
  if (!m) {
    return key;
  }
  const [, y, mo, d, rest] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  if (Number.isNaN(date.getTime())) {
    return key;
  }
  const dateLabel = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return `${rest} · ${dateLabel}`;
}

/**
 * Tournament type classification (regional / international / online / special).
 * Used to group + filter in the selector.
 */
export function classifyTournament(key: string): 'online' | 'regional' | 'international' | 'special' | 'other' {
  if (key === ONLINE) {
    return 'online';
  }
  const lower = key.toLowerCase();
  if (lower.includes('international championship')) {
    return 'international';
  }
  if (lower.includes('regional championship')) {
    return 'regional';
  }
  if (lower.includes('special event')) {
    return 'special';
  }
  return 'other';
}

// --- Upcoming tournaments (Limitless scraper Function) ---
// Types live in shared/upcomingTypes.ts so the producing Pages Function
// (functions/api/limitless/upcoming.ts — owned separately) can share them.
// FOLLOW-UP: point that Function's inline types at shared/upcomingTypes.ts too.

// --- Trend report (cron-built, daily timeline per archetype) ---

export interface TrendTimelinePoint {
  /** YYYY-MM-DD */
  date: string;
  /** Decks of this archetype on this day */
  decks: number;
  /** Total decks across all archetypes on this day */
  totalDecks: number;
  /** Share as a percentage 0..100 (= decks / totalDecks * 100) */
  share: number;
}

interface TrendSeries {
  /** Archetype slug, matches archetypes/index.json `name` */
  base: string;
  /** Human-readable name */
  displayName: string;
  totalDecks: number;
  appearances: number;
  avgShare: number;
  maxShare: number;
  peakShare?: number;
  minShare: number;
  /** Daily timeline, ascending date order */
  timeline: TrendTimelinePoint[];
}

interface CardTrendEntry {
  key: string;
  name: string;
  set: string | null;
  number: string | null;
  appearances: number;
  startShare: number;
  endShare: number;
  delta: number;
  currentShare: number;
}

export interface OnlineTrendsPayload {
  trendReport: {
    generatedAt: string;
    windowStart: string;
    windowEnd: string;
    deckTotal: number;
    tournamentCount: number;
    archetypeCount: number;
    series: TrendSeries[];
  };
  cardTrends: {
    generatedAt: string;
    windowStart: string;
    windowEnd: string;
    cardsAnalyzed: number;
    rising: CardTrendEntry[];
    falling: CardTrendEntry[];
  };
}

/**
 * Reads the trends file produced by the online-meta cron.
 * Lives at `reports/Trends - Last 30 Days/trends.json`.
 *
 * Contains 30 daily timeline points per archetype plus pre-computed
 * rising/falling card lists. Returns null if the file isn't there yet.
 */
const TRENDS_FOLDER = 'Trends - Last 30 Days';
export async function fetchOnlineTrendReport(): Promise<OnlineTrendsPayload | null> {
  const [raw, db] = await Promise.all([
    fetchJsonOptional<OnlineTrendsPayload>(`/reports/${encodeURIComponent(TRENDS_FOLDER)}/trends.json`),
    getSynonymDatabase()
  ]);
  if (!raw || !db) {
    return raw;
  }
  return {
    ...raw,
    cardTrends: {
      ...raw.cardTrends,
      rising: canonicalizeCardTrendEntries(raw.cardTrends.rising ?? [], db),
      falling: canonicalizeCardTrendEntries(raw.cardTrends.falling ?? [], db)
    }
  };
}

/**
 * Reads the majors-trends file produced by the pipeline
 * (`.github/scripts/run-majors-trends.ts`), stored at `reports/majors-trends.json`.
 *
 * Carries the precomputed archetype-share timeline + card movers for the last
 * 3 / 5 / 10 major events — the same result the page used to compute in the
 * browser from up to ten full `master.json` files (~5 MB). Set/number in the
 * mover rows are already canonicalized at build time, so no read-time merge is
 * needed here. Returns null (404) until the pipeline has run, so callers fall
 * back to the client-side computation.
 */
export function fetchMajorsTrendReport(): Promise<MajorsTrendsPayload | null> {
  return fetchJsonOptional<MajorsTrendsPayload>('/reports/majors-trends.json');
}

/**
 * Hits the /api/limitless/upcoming Pages Function, which scrapes Limitless's
 * upcoming-tournaments page and caches at the edge for 6 hours.
 */
export async function fetchUpcomingTournaments(): Promise<UpcomingPayload | null> {
  try {
    const response = await fetch('/api/limitless/upcoming', { mode: 'cors' });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as UpcomingPayload;
  } catch {
    return null;
  }
}

// --- Tournament-classification helpers ---

/**
 * Parse the date portion of a tournament key like "2026-05-08, Regional Championship Los Angeles".
 */
export function tournamentDate(key: string): Date | null {
  if (key === ONLINE) {
    return null;
  }
  const m = key.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) {
    return null;
  }
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Filter a tournament list to "majors" (regional / international / special).
 */
export function majorTournaments(list: string[]): string[] {
  return list.filter(t => {
    const c = classifyTournament(t);
    return c === 'regional' || c === 'international' || c === 'special';
  });
}
