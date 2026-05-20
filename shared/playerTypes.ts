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
  day2s: number;
  topCuts: number;
  tournamentWins: number;
  lastEventDate: string;
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
  archetype: string | null;
  deckId: string | null;
}

/**
 * Aggregate career summary on a player's profile. Day 2 is the "good event" bar.
 * `winRate`, `day2Rate`, `matchesPlayed` are derived client-side.
 */
export interface PlayerProfileSummary {
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
  aliases: string[];
  countries: string[];
  generatedAt: string;
  summary: PlayerProfileSummary;
  /** archetype base → display name, used by both summary rollup and tournament rows */
  archetypeNames: Record<string, string>;
  archetypes: PlayerArchetypeBreakdown[];
  tournaments: PlayerTournamentEntry[];
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
