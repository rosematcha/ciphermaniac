import type { Deck } from '../types/index.js';

const CACHE_KEY = 'players-regionals-v1';
const CACHE_TTL_MS = 1000 * 60 * 60 * 6;
const FETCH_CONCURRENCY = 4;
const UNKNOWN_NAMES = new Set(['unknown player', 'unknown']);
const LOCAL_REPORTS_BASE = '/reports';
const R2_REPORTS_BASE = 'https://r2.ciphermaniac.com/reports';

export interface PlayerAppearance {
  tournament: string;
  date: string | null;
  placement: number | null;
  tournamentPlayers: number | null;
  archetype: string;
}

export interface PlayerProfile {
  key: string;
  slug: string;
  name: string;
  events: number;
  entries: number;
  bestFinish: number | null;
  avgFinish: number | null;
  wins: number;
  top8: number;
  top16: number;
  top8Rate: number;
  top16Rate: number;
  consistency: number;
  primaryArchetype: { name: string; count: number; share: number } | null;
  lastEvent: string | null;
  archetypes: Array<{ name: string; count: number }>;
  history: PlayerAppearance[];
}

export interface PlayerDataset {
  generatedAt: string;
  regionals: string[];
  decksAnalyzed: number;
  playerCount: number;
  repeatPlayerCount: number;
  players: PlayerProfile[];
}

type PlayerSlice = 'all' | 'phase2' | 'topcut';

interface CacheEntry {
  timestamp: number;
  data: PlayerDataset;
}

interface MutablePlayer {
  key: string;
  slug: string;
  names: Map<string, number>;
  displayName: string;
  events: Set<string>;
  entries: number;
  wins: number;
  top8: number;
  top16: number;
  bestFinish: number | null;
  placementTotal: number;
  placementCount: number;
  lastEvent: string | null;
  archetypes: Map<string, number>;
  history: PlayerAppearance[];
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function buildReportCandidateUrls(relativePath: string): string[] {
  const normalizedPath = relativePath.startsWith('/') ? relativePath : `/${relativePath}`;
  const localUrl = `${LOCAL_REPORTS_BASE}${normalizedPath}`.replace('//', '/');
  const r2Url = `${R2_REPORTS_BASE}${normalizedPath}`;
  return [localUrl, r2Url];
}

async function fetchJsonArray(relativePath: string): Promise<any[] | null> {
  const urls = buildReportCandidateUrls(relativePath);
  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        continue;
      }
      const parsed = await response.json();
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      // try next source
    }
  }
  return null;
}

function normalizePlayerName(raw: unknown): string {
  const name = normalizeWhitespace(String(raw || ''));
  if (!name) {
    return '';
  }
  if (UNKNOWN_NAMES.has(name.toLowerCase())) {
    return '';
  }
  return name;
}

function playerKeyFromName(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ');
  return normalizeWhitespace(base);
}

function inferTournamentDate(tournament: string): string | null {
  const value = normalizeWhitespace(String(tournament || ''));
  const match = value.match(/^(\d{4}-\d{2}-\d{2}),/);
  return match?.[1] || null;
}

function playerSlugFromName(name: string): string {
  return playerKeyFromName(name).replace(/\s+/g, '-');
}

function toFiniteInt(value: unknown): number | null {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return null;
  }
  const rounded = Math.round(num);
  return rounded > 0 ? rounded : null;
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, handler: (item: T) => Promise<R>): Promise<R[]> {
  if (!items.length) {
    return [];
  }
  const max = Math.max(1, Math.min(limit, items.length));
  const out = new Array<R>(items.length);
  let index = 0;

  async function worker(): Promise<void> {
    while (index < items.length) {
      const i = index;
      index += 1;
      if (i >= items.length) {
        return;
      }
      // eslint-disable-next-line no-await-in-loop
      out[i] = await handler(items[i]);
    }
  }

  await Promise.all(Array.from({ length: max }, () => worker()));
  return out;
}

function readCache(cacheKey = CACHE_KEY): PlayerDataset | null {
  try {
    const raw = globalThis.localStorage?.getItem(cacheKey);
    if (!raw) {
      return null;
    }
    const payload = JSON.parse(raw) as CacheEntry;
    if (!payload?.timestamp || !payload?.data) {
      return null;
    }
    if (Date.now() - payload.timestamp > CACHE_TTL_MS) {
      return null;
    }
    return payload.data;
  } catch {
    return null;
  }
}

function writeCache(data: PlayerDataset, cacheKey = CACHE_KEY): void {
  try {
    const payload: CacheEntry = {
      timestamp: Date.now(),
      data
    };
    globalThis.localStorage?.setItem(cacheKey, JSON.stringify(payload));
  } catch {
    // cache is optional
  }
}

function chooseDisplayName(player: MutablePlayer): string {
  let bestName = player.displayName;
  let bestCount = -1;
  player.names.forEach((count, name) => {
    if (count > bestCount) {
      bestName = name;
      bestCount = count;
    }
  });
  return bestName;
}

function comparePlayers(a: PlayerProfile, b: PlayerProfile): number {
  return (
    b.consistency - a.consistency ||
    b.top16Rate - a.top16Rate ||
    b.top8Rate - a.top8Rate ||
    b.top8 - a.top8 ||
    b.events - a.events ||
    (a.avgFinish ?? Number.POSITIVE_INFINITY) - (b.avgFinish ?? Number.POSITIVE_INFINITY) ||
    a.name.localeCompare(b.name)
  );
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

function computeConsistencyScore(params: {
  events: number;
  top8Rate: number;
  top16Rate: number;
  bestFinish: number | null;
  avgFinish: number | null;
}): number {
  const { events, top8Rate, top16Rate, bestFinish, avgFinish } = params;
  if (events <= 0) {
    return 0;
  }

  const eventWeight = clamp(Math.log2(events + 1) / Math.log2(13), 0, 1);
  const bestFinishScore = bestFinish && bestFinish > 0 ? clamp((33 - Math.min(bestFinish, 32)) / 32, 0, 1) : 0;
  const avgFinishScore = avgFinish && avgFinish > 0 ? clamp((33 - Math.min(avgFinish, 32)) / 32, 0, 1) : 0;

  const weighted = top16Rate * 0.4 + top8Rate * 0.35 + bestFinishScore * 0.15 + avgFinishScore * 0.1;

  return Math.round(weighted * eventWeight * 1000) / 1000;
}

async function buildPlayerDataset(slice: PlayerSlice = 'all'): Promise<PlayerDataset> {
  const tournaments = await fetchJsonArray('tournaments.json');
  const regionals = (Array.isArray(tournaments) ? tournaments : []).filter(item => /regional/i.test(String(item)));

  const decksByTournament = await mapWithConcurrency(regionals, FETCH_CONCURRENCY, async tournament => {
    const relativePath =
      slice === 'all'
        ? `${encodeURIComponent(tournament)}/decks.json`
        : `${encodeURIComponent(tournament)}/slices/${slice}/decks.json`;
    const decks = await fetchJsonArray(relativePath);
    return {
      tournament,
      decks: Array.isArray(decks) ? decks : []
    };
  });

  const players = new Map<string, MutablePlayer>();
  let decksAnalyzed = 0;

  decksByTournament.forEach(({ tournament, decks }) => {
    const inferredDate = inferTournamentDate(tournament);
    const inferredTournamentPlayers = decks.length > 0 ? decks.length : null;

    decks.forEach((deck: Deck) => {
      decksAnalyzed += 1;
      const playerName = normalizePlayerName(deck?.player);
      if (!playerName) {
        return;
      }
      const key = playerKeyFromName(playerName);
      if (!key) {
        return;
      }

      if (!players.has(key)) {
        players.set(key, {
          key,
          slug: playerSlugFromName(playerName),
          names: new Map([[playerName, 1]]),
          displayName: playerName,
          events: new Set(),
          entries: 0,
          wins: 0,
          top8: 0,
          top16: 0,
          bestFinish: null,
          placementTotal: 0,
          placementCount: 0,
          lastEvent: null,
          archetypes: new Map(),
          history: []
        });
      }

      const row = players.get(key);
      if (!row) {
        return;
      }
      row.names.set(playerName, (row.names.get(playerName) || 0) + 1);
      row.entries += 1;
      row.events.add(tournament);

      const placement = toFiniteInt(deck?.placement ?? deck?.placing);
      if (placement) {
        row.bestFinish = row.bestFinish === null ? placement : Math.min(row.bestFinish, placement);
        row.placementTotal += placement;
        row.placementCount += 1;
        if (placement === 1) {
          row.wins += 1;
        }
        if (placement <= 8) {
          row.top8 += 1;
        }
        if (placement <= 16) {
          row.top16 += 1;
        }
      }

      const archetype = normalizeWhitespace(String(deck?.archetype || 'Unknown'));
      row.archetypes.set(archetype, (row.archetypes.get(archetype) || 0) + 1);

      const date =
        typeof deck?.tournamentDate === 'string' && deck.tournamentDate
          ? normalizeWhitespace(deck.tournamentDate)
          : inferredDate;
      if (date) {
        if (!row.lastEvent || Date.parse(date) > Date.parse(row.lastEvent)) {
          row.lastEvent = date;
        }
      }

      row.history.push({
        tournament: typeof deck?.tournamentName === 'string' && deck.tournamentName ? deck.tournamentName : tournament,
        date,
        placement,
        tournamentPlayers: toFiniteInt(deck?.tournamentPlayers ?? deck?.players) ?? inferredTournamentPlayers,
        archetype
      });
    });
  });

  const profiles = Array.from(players.values())
    .map(player => {
      const displayName = chooseDisplayName(player);
      const archetypes = Array.from(player.archetypes.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
        .slice(0, 8);
      const history = [...player.history].sort(
        (a, b) => Date.parse(b.date || '0') - Date.parse(a.date || '0') || (a.placement || 9999) - (b.placement || 9999)
      );
      const avgFinish =
        player.placementCount > 0 ? Math.round((player.placementTotal / player.placementCount) * 10) / 10 : null;
      const events = player.events.size;
      const top8Rate = events > 0 ? player.top8 / events : 0;
      const top16Rate = events > 0 ? player.top16 / events : 0;
      const primaryArchetype = archetypes[0]
        ? {
            name: archetypes[0].name,
            count: archetypes[0].count,
            share: player.entries > 0 ? archetypes[0].count / player.entries : 0
          }
        : null;
      const consistency = computeConsistencyScore({
        events,
        top8Rate,
        top16Rate,
        bestFinish: player.bestFinish,
        avgFinish
      });

      return {
        key: player.key,
        slug: player.slug,
        name: displayName,
        events,
        entries: player.entries,
        bestFinish: player.bestFinish,
        avgFinish,
        wins: player.wins,
        top8: player.top8,
        top16: player.top16,
        top8Rate,
        top16Rate,
        consistency,
        primaryArchetype,
        lastEvent: player.lastEvent,
        archetypes,
        history
      } satisfies PlayerProfile;
    })
    .sort(comparePlayers);

  return {
    generatedAt: new Date().toISOString(),
    regionals,
    decksAnalyzed,
    playerCount: profiles.length,
    repeatPlayerCount: profiles.filter(profile => profile.events >= 2).length,
    players: profiles
  };
}

export async function loadPlayerDataset(forceRefresh = false, slice: PlayerSlice = 'all'): Promise<PlayerDataset> {
  const scopedCacheKey = `${CACHE_KEY}:${slice}`;
  if (!forceRefresh) {
    const cached = readCache(scopedCacheKey);
    if (cached) {
      return cached;
    }
  }
  const data = await buildPlayerDataset(slice);
  writeCache(data, scopedCacheKey);
  return data;
}

export function findPlayerBySlug(dataset: PlayerDataset, slug: string): PlayerProfile | null {
  const value = normalizeWhitespace(String(slug || '').toLowerCase()).replace(/_/g, '-');
  if (!value) {
    return null;
  }
  const exact = dataset.players.find(player => player.slug === value);
  if (exact) {
    return exact;
  }

  const keyFromSlug = playerKeyFromName(value.replace(/-/g, ' '));
  if (!keyFromSlug) {
    return null;
  }
  return dataset.players.find(player => player.key === keyFromSlug) || null;
}
