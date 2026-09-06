/**
 * Cross-tournament player aggregate types.
 *
 * Shared between the cron-side aggregator (`functions/lib/onlineMeta/playerAggregator.ts`)
 * that writes these files into R2 and the frontend (`src/pages/PlayerProfilePage.tsx`,
 * `src/pages/PlayersPage.tsx`) that reads them back. Keeping them in one place
 * prevents the two sides from drifting — if the writer changes a field, the
 * reader breaks at type-check time rather than at runtime.
 *
 * Storage layout the cron produces:
 *   players/index.json                 → PlayerIndexEntry[]
 *   players/{playerId}/profile.json    → PlayerProfile
 *   players/{playerId}/decks.json      → PlayerDecks
 *   players/_manifest.json             → PlayerAggregateManifest (internal)
 */

/** Lightweight entry in `players/index.json` for the cross-tournament index page. */
export interface PlayerIndexEntry {
  playerId: string;
  name: string;
  country?: string;
  eventCount: number;
  /** Career match record; the index ranks by win rate as well as by counts. */
  wins: number;
  losses: number;
  day2s: number;
  topCuts: number;
  tournamentWins: number;
  lastEventDate: string;
}

/**
 * Slim projection served at `players/index-slim.json`. Carries exactly the
 * fields the players index table and the compare-page autocomplete render —
 * everything in `PlayerIndexEntry` except `lastEventDate`, which is used only
 * for the server-side index ordering (the array preserves that order, so the
 * field itself is dead weight on the wire). Entry order matches `index.json`.
 */
export interface PlayerIndexSlimEntry {
  playerId: string;
  name: string;
  country?: string;
  eventCount: number;
  wins: number;
  losses: number;
  day2s: number;
  topCuts: number;
  tournamentWins: number;
}

/**
 * Columnar wire format for `players/index-slim.json`. Same data as
 * `PlayerIndexSlimEntry[]`, but the seven field names are written once instead
 * of once per player (~20k rows), which roughly halves the raw payload and
 * shrinks the gzipped one. Arrays are index-aligned; `countries[i]` is `''`
 * when unknown.
 */
export interface PlayerIndexSlimColumnar {
  format: 'slim-columnar-v1';
  playerIds: string[];
  names: string[];
  countries: string[];
  eventCounts: number[];
  /** Absent in files written before win rate reached the index; decode as 0. */
  wins?: number[];
  losses?: number[];
  day2s: number[];
  topCuts: number[];
  tournamentWins: number[];
}

/** Project index entries to the columnar slim wire shape. */
export function encodeSlimIndex(
  entries: readonly (PlayerIndexEntry | PlayerIndexSlimEntry)[]
): PlayerIndexSlimColumnar {
  const out: PlayerIndexSlimColumnar = {
    format: 'slim-columnar-v1',
    playerIds: [],
    names: [],
    countries: [],
    eventCounts: [],
    wins: [],
    losses: [],
    day2s: [],
    topCuts: [],
    tournamentWins: []
  };
  for (const e of entries) {
    out.playerIds.push(e.playerId);
    out.names.push(e.name);
    out.countries.push(e.country ?? '');
    out.eventCounts.push(e.eventCount);
    out.wins!.push(e.wins);
    out.losses!.push(e.losses);
    out.day2s.push(e.day2s);
    out.topCuts.push(e.topCuts);
    out.tournamentWins.push(e.tournamentWins);
  }
  return out;
}

/**
 * Decode either wire shape of the slim index: the columnar payload, or a
 * legacy row array (which also covers the full `index.json`, whose entries are
 * a superset of the slim shape). Returns null for anything unrecognizable so
 * callers can fall back to another source.
 */
export function decodeSlimIndex(payload: unknown): PlayerIndexSlimEntry[] | null {
  if (Array.isArray(payload)) {
    return (payload as Array<Partial<PlayerIndexSlimEntry>>).map(e => ({
      ...e,
      wins: e.wins ?? 0,
      losses: e.losses ?? 0
    })) as PlayerIndexSlimEntry[];
  }
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const p = payload as Partial<PlayerIndexSlimColumnar>;
  if (
    p.format !== 'slim-columnar-v1' ||
    !Array.isArray(p.playerIds) ||
    !Array.isArray(p.names) ||
    !Array.isArray(p.countries) ||
    !Array.isArray(p.eventCounts) ||
    !Array.isArray(p.day2s) ||
    !Array.isArray(p.topCuts) ||
    !Array.isArray(p.tournamentWins)
  ) {
    return null;
  }
  const entries: PlayerIndexSlimEntry[] = [];
  for (let i = 0; i < p.playerIds.length; i += 1) {
    entries.push({
      playerId: p.playerIds[i],
      name: p.names[i] ?? '',
      country: p.countries[i] || undefined,
      eventCount: p.eventCounts[i] ?? 0,
      wins: p.wins?.[i] ?? 0,
      losses: p.losses?.[i] ?? 0,
      day2s: p.day2s[i] ?? 0,
      topCuts: p.topCuts[i] ?? 0,
      tournamentWins: p.tournamentWins[i] ?? 0
    });
  }
  return entries;
}

/**
 * Per-archetype rollup within a player's career profile. `displayName` is not
 * stored on each row — look it up via `PlayerProfile.archetypeNames[base]`.
 * Derived stats (winRate, matchesPlayed) are computed client-side.
 */
export interface PlayerArchetypeBreakdown {
  base: string;
  eventCount: number;
  wins: number;
  losses: number;
  ties: number;
  day2s: number;
  topCuts: number;
  bestPlacement: number | null;
}

/**
 * Minimal card entry. Lives in `players/{playerId}/decks.json`, lazy-fetched
 * on first row expand on the profile page.
 */
export interface PlayerDeckCard {
  count: number;
  name: string;
  set?: string;
  number?: string;
  category?: string;
}

/**
 * One tournament's record on a player's profile. `archetype` is the base slug;
 * resolve display name via `PlayerProfile.archetypeNames[archetype]`.
 */
export interface PlayerTournamentEntry {
  tournamentId: string;
  tournamentDate: string;
  totalPlayers: number | null;
  placement: number | null;
  wins: number;
  losses: number;
  ties: number;
  madePhase2: boolean;
  madeTopCut: boolean;
  /** Round after which the player dropped, when the standings recorded one. */
  dropRound?: number | null;
  archetype: string | null;
  deckId: string | null;
}

/** Per-side result of one round, as the event's match data records it. */
export type PlayerRoundOutcome = 'win' | 'loss' | 'tie' | 'double_loss' | 'bye' | 'unpaired' | 'unknown';

/**
 * One round from the player's side. Lives in `players/{playerId}/matches.json`,
 * lazy-fetched by the profile's opened events and its Matchups tab.
 *
 * `opponentName` is the opponent's CURRENT display name, resolved at build time
 * from their own career record, never the name the event recorded — a prior
 * name must not reach a published artifact. Opponents with no career id keep
 * the event's name, since there is nothing newer to resolve to.
 */
export interface PlayerRound {
  round: number;
  /** 1 = Day 1 Swiss, 2 = Day 2 Swiss, 3 = top cut; null when the source did not say. */
  phase: number | null;
  outcome: PlayerRoundOutcome;
  /** Career player id, for a link to the opponent's profile; null for a bye or an id-less opponent. */
  opponentId: string | null;
  opponentName: string | null;
  opponentCountry: string | null;
  /** Opponent's deck label at this event, e.g. "Dragapult Dusknoir". */
  opponentArchetype: string | null;
  /** Where the opponent finished this event. */
  opponentPlacement: number | null;
}

/**
 * Aggregate career summary on a player's profile. Day 2 is the "good event" bar.
 * `winRate`, `day2Rate`, `matchesPlayed` are derived client-side.
 */
interface PlayerProfileSummary {
  eventCount: number;
  firstEventDate: string;
  lastEventDate: string;
  wins: number;
  losses: number;
  ties: number;
  day2s: number;
  topCuts: number;
  tournamentWins: number;
  bestPlacement: number | null;
  medianPlacement: number | null;
}

/**
 * Full player profile at `players/{playerId}/profile.json`. Decklists are in a
 * sibling `decks.json`, fetched lazily.
 */
export interface PlayerProfile {
  playerId: string;
  name: string;
  countries: string[];
  generatedAt: string;
  summary: PlayerProfileSummary;
  /** archetype base → display name, used by both summary rollup and tournament rows */
  archetypeNames: Record<string, string>;
  archetypes: PlayerArchetypeBreakdown[];
  tournaments: PlayerTournamentEntry[];
  /**
   * Every round played, keyed by `tournamentId`, each list in round order. Only
   * events whose match data was published appear.
   *
   * These ride along in the profile rather than in a file of their own: they are
   * small next to a decklist (the heaviest career gzips to 13KB of rounds, the
   * median to well under one), they feed two tabs at once, and a separate object
   * would double the aggregator's writes for no gain — R2 bills operations and
   * bytes, never object count.
   *
   * Optional because the aggregator started writing it after profiles already
   * existed: a body cached before that run — R2 serves these for six hours —
   * has no `rounds`, so every reader must treat absence as "none published".
   */
  rounds?: Record<string, PlayerRound[]>;
}

/**
 * `players/{playerId}/decks.json`: map of `tournamentId` to its decklist.
 * Only tournaments where the player had a published decklist appear here.
 */
export interface PlayerDecks {
  playerId: string;
  generatedAt: string;
  decks: Record<string, PlayerDeckCard[]>;
}

/**
 * `players/_manifest.json` — bookkeeping for incremental rebuilds. Maps each
 * player to the set of tournament keys present in their last-written profile,
 * so we can skip rewriting profiles whose membership hasn't changed.
 *
 * Internal to the cron; not consumed by the frontend.
 */
export interface PlayerAggregateManifest {
  generatedAt: string;
  /**
   * Tournament keys that were successfully loaded in the last run. Keys present
   * in `reports/tournaments.json` but whose slice failed to load are NOT
   * recorded here, so the next run's fast-path will retry them instead of
   * permanently masking them as "covered".
   */
  tournamentKeys: string[];
  /** playerId → sorted list of tournament keys included in their profile. */
  players: Record<string, string[]>;
}
