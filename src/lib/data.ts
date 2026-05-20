/**
 * Thin data layer wrapping the production R2 reports.
 *
 * Hits `https://r2.ciphermaniac.com/reports/...` directly from the browser
 * (CORS allowed). No Functions on the page-render critical path.
 *
 * Solid resources handle their own caching; this module is intentionally
 * stateless beyond a tiny in-memory dedupe map so two parallel calls for the
 * same URL share a single fetch.
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
  PlayerProfile,
  TournamentParticipant
} from '../types';
import { getCanonicalCardFromData, type SynonymDatabase } from '../../shared/synonyms.js';
import { getSynonymDatabase } from '../utils/cardSynonyms';
import { calculatePercentage } from '../../shared/reportUtils.js';

const R2_BASE = 'https://r2.ciphermaniac.com';

const inflight = new Map<string, Promise<unknown>>();

/**
 * Snapshot data (frozen pre-rotation reports) lives at /reports/Snapshots/{date}/.
 * In dev, the build-rotation-snapshots script writes to `static/reports/Snapshots/`
 * so vite serves them at the root; in prod they're on R2 like everything else.
 * We pick the right base per call rather than per-helper so non-snapshot reads
 * keep their fast path.
 */
function shouldUseLocalForPath(path: string): boolean {
  return import.meta.env.DEV && path.startsWith('/reports/Snapshots/');
}

async function fetchJson<T>(path: string): Promise<T> {
  const url = shouldUseLocalForPath(path) ? path : `${R2_BASE}${path}`;
  if (inflight.has(url)) {
    return inflight.get(url) as Promise<T>;
  }
  // Only the in-flight dedupe is cached; a rejected promise is removed
  // synchronously so the next caller (e.g. a user-triggered retry) gets a
  // fresh fetch instead of being handed back the cached failure.
  const promise = (async () => {
    const response = await fetch(url, { mode: 'cors' });
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as T;
  })();
  promise.then(
    () => undefined,
    () => inflight.delete(url)
  );
  inflight.set(url, promise);
  return promise as Promise<T>;
}

/**
 * Optional variant of fetchJson that resolves to null on 404 rather than throwing.
 */
async function fetchJsonOptional<T>(path: string): Promise<T | null> {
  const url = shouldUseLocalForPath(path) ? path : `${R2_BASE}${path}`;
  if (inflight.has(url)) {
    return inflight.get(url) as Promise<T | null>;
  }
  const promise = (async () => {
    const response = await fetch(url, { mode: 'cors' });
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as T;
  })();
  promise.then(
    () => undefined,
    () => inflight.delete(url)
  );
  inflight.set(url, promise);
  return promise as Promise<T | null>;
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

export function snapshotDateFromSource(source: string): string | null {
  return isSnapshotSource(source) ? source.slice(SNAPSHOT_SOURCE_PREFIX.length) : null;
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
 * Compute the UID for a card item. Prefers an explicit `uid` field, then
 * `Name::SET::NUMBER`, then bare name as a last resort.
 */
function itemUid(item: CardItem): string {
  if (item.uid) {
    return item.uid;
  }
  if (item.set && item.number !== undefined && item.number !== null) {
    return `${item.name}::${item.set}::${item.number}`;
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
      // First occurrence — clone and stamp with canonical identity.
      const next: AnyCardItem = { ...item, uid: canonicalUid };
      if (canonicalParts && canonicalParts.length >= 3) {
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

export async function fetchMaster(tournament: string = ONLINE): Promise<MasterPayload> {
  const [raw, db] = await Promise.all([
    fetchJson<MasterPayload>(`${tournamentPath(tournament)}/master.json`),
    getSynonymDatabase()
  ]);
  return canonicalizeReport(raw, db);
}

export function fetchArchetypes(tournament: string = ONLINE): Promise<ArchetypeIndexEntry[]> {
  return fetchJson<ArchetypeIndexEntry[]>(`${tournamentPath(tournament)}/archetypes/index.json`);
}

export async function fetchArchetype(tournament: string, archetypeBase: string): Promise<ArchetypeReport> {
  const [raw, db] = await Promise.all([
    fetchJson<ArchetypeReport>(
      `${tournamentPath(tournament)}/archetypes/${encodeURIComponent(archetypeBase)}/cards.json`
    ),
    getSynonymDatabase()
  ]);
  return canonicalizeReport(raw, db);
}

// Backwards-compatible aliases (always online meta)
export const fetchOnlineMeta = (): Promise<MetaReport> => fetchMeta(ONLINE);
export const fetchOnlineMaster = (): Promise<MasterPayload> => fetchMaster(ONLINE);
export const fetchOnlineArchetypes = (): Promise<ArchetypeIndexEntry[]> => fetchArchetypes(ONLINE);
export const fetchOnlineArchetype = (slug: string): Promise<ArchetypeReport> => fetchArchetype(ONLINE, slug);

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
  const numTrim = String(number).replace(/^0+/, '') || '0';
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

export interface DeckCardRecord {
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
}

export function fetchDecks(tournament: string): Promise<DeckRecord[] | null> {
  return fetchJsonOptional<DeckRecord[]>(`${tournamentPath(tournament)}/decks.json`);
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
export interface PricingPayload {
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
function normalizeCardNumberKey(raw: string): string {
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
  const key = `${set.toUpperCase()}::${number.replace(/^0+/, '') || '0'}`;
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
    const vNum = parts[2].replace(/^0+/, '') || '0';
    const cParts = canonicalUid.split('::');
    if (cParts.length < 3) {
      continue;
    }
    const cKey = `${cParts[1].toUpperCase()}::${cParts[2].replace(/^0+/, '') || '0'}`;
    index.set(`${vSet}::${vNum}`, { key: cKey, set: cParts[1], number: cParts[2] });
  }
  setNumberIndexCache.set(db, index);
  return index;
}

/**
 * Slugify a card name for URL fallback (the canonical URL is set+number).
 */
export function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '');
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

/**
 * Slugify a tournament key for URLs.
 * "2026-05-08, Regional Championship Los Angeles" → "2026-05-08-regional-championship-los-angeles"
 */
export function tournamentSlug(key: string): string {
  if (key === ONLINE) {
    return 'online';
  }
  return key
    .toLowerCase()
    .replace(/,/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '');
}

/**
 * Resolve a tournament slug back to its full key. Used when reading slug from URL.
 */
export async function tournamentFromSlug(slug: string): Promise<string | null> {
  if (slug === 'online') {
    return ONLINE;
  }
  const list = await fetchTournamentsList();
  return list.find(t => tournamentSlug(t) === slug) ?? null;
}

// --- Upcoming tournaments (Limitless scraper Function) ---

export interface UpcomingEvent {
  date: string;
  country: string;
  name: string;
  format: string;
  type: 'regional' | 'international' | 'special' | 'worlds' | 'other';
  limitlessUrl?: string;
  externalUrl?: string;
}

export interface UpcomingPayload {
  refreshedAt: string;
  source: string;
  events: UpcomingEvent[];
}

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

export interface TrendSeries {
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

export interface CardTrendEntry {
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
