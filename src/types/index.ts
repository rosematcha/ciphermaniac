/**
 * Shared TypeScript type definitions for the Ciphermaniac application.
 * These interfaces represent the core data structures used across the codebase.
 * @module types
 */

// =============================================================================
// Card-Related Types
// =============================================================================

/**
 * Distribution entry for card copy counts.
 * Represents how many players use a specific number of copies of a card.
 */
export interface CardDistributionEntry {
  /** Number of copies of the card */
  copies?: number;
  /** Number of players using this many copies */
  players?: number;
  /** Percentage of decks using this many copies */
  percent?: number;
}

/**
 * Card item from a tournament or archetype report.
 * Contains usage statistics and metadata for a single card.
 */
export interface CardItem {
  /** Rank within the report (1-based) */
  rank?: number;
  /** Card name */
  name: string;
  /** Unique identifier in format "Name::SET::NUMBER" */
  uid?: string;
  /** Set code (e.g., "PAF", "SFA") */
  set?: string;
  /** Card collector number */
  number?: string | number;
  /** Category path (e.g., "pokemon", "trainer/supporter", "energy/basic") */
  category?: string;
  /** Trainer subtype (e.g., "supporter", "item", "tool", "stadium") */
  trainerType?: string;
  /** Energy subtype (e.g., "basic", "special") */
  energyType?: string;
  /** Whether this card is an Ace Spec */
  aceSpec?: boolean;
  /** Pokemon TCG supertype from API */
  supertype?: string;
  /** Regulation mark (e.g., "G", "H", "I") for format legality */
  regulationMark?: string;
  /** Number of decks containing this card */
  found: number;
  /** Total number of decks analyzed */
  total: number;
  /** Percentage of decks containing this card */
  pct: number;
  /** Distribution of copy counts */
  dist?: CardDistributionEntry[];
  /** Price in USD (enriched from pricing data) */
  price?: number | null;
}

/**
 * Full tournament participant row from Labs standings.
 */
export interface TournamentParticipant {
  tpId: number;
  playerId?: number | string | null;
  name: string;
  country?: string | null;
  placement?: number | null;
  points?: number | null;
  wins?: number | null;
  losses?: number | null;
  ties?: number | null;
  opw?: string | number | null;
  oopw?: string | number | null;
  madePhase2?: boolean;
  madeTopCut?: boolean;
  decklistPublished?: boolean;
  deckId?: string | null;
  deckName?: string | null;
  icons?: string | null;
  dropRound?: number | null;
  dropped?: boolean;
  dqed?: boolean;
  late?: boolean;
}

// =============================================================================
// Cross-tournament Player Profile Types
// =============================================================================

// Player-aggregate types live in `shared/playerTypes.ts` so the cron-side
// writer (functions/lib/onlineMeta/playerAggregator.ts) and the SPA-side
// reader can't drift. Re-exported here so existing `from '../types'` imports
// keep working without churn.
export type {
  PlayerDeckCard,
  PlayerDecks,
  PlayerIndexEntry,
  PlayerIndexSlimEntry,
  PlayerProfile,
  PlayerTournamentEntry
} from '../../shared/playerTypes.js';

/**
 * Round-by-round player perspective match record.
 */
export interface PlayerMatchRecord {
  id: string;
  playerId: number | string;
  playerName?: string;
  opponentId?: number | string | null;
  opponentName?: string | null;
  opponentCountry?: string | null;
  opponentArchetype?: string | null;
  playerArchetype?: string | null;
  round: number;
  phase?: number | null;
  table?: number | null;
  completed?: boolean;
  winnerCode?: number | null;
  outcome?: 'win' | 'loss' | 'tie' | 'double_loss' | 'bye' | 'unpaired' | 'unknown';
  madePhase2?: boolean;
  madeTopCut?: boolean;
}

// =============================================================================
// Report Types
// =============================================================================

/**
 * Tournament report containing aggregated card data.
 * This is the main report structure for tournaments and archetypes.
 */
interface TournamentReport {
  /** Total number of decks analyzed */
  deckTotal: number;
  /** Card items with usage statistics */
  items: CardItem[];
  /** Whether this report was generated client-side */
  generatedClientSide?: boolean;
  /** Raw generation metadata */
  raw?: {
    generatedClientSide: true;
    filterCount: number;
  };
}

/**
 * Archetype report with card statistics.
 * Same structure as TournamentReport but for a specific archetype.
 */
export interface ArchetypeReport extends TournamentReport {
  /** Deck instances for each card (for client-side filtering) */
  items: (CardItem & {
    /** Deck instances where this card appears */
    deckInstances?: Array<{ deckId: string; count: number; archetype?: string }>;
  })[];
}

/**
 * Signature card entry for archetype display.
 * These are cards that best exemplify the archetype.
 */
interface SignatureCardEntry {
  /** Card name */
  name: string;
  /** Set code */
  set: string | null;
  /** Collector number */
  number: string | null;
  /** Usage percentage in this archetype */
  pct: number;
}

/**
 * Entry in the archetype index (list of archetypes for a tournament).
 */
export interface ArchetypeIndexEntry {
  /** Base name used in URLs and file paths */
  name: string;
  /** Human-readable display name */
  label: string;
  /** Number of decks for this archetype */
  deckCount: number | null;
  /** Percentage of meta share */
  percent: number | null;
  /** Thumbnail image paths (e.g., ["PAF/001", "SFA/025"]) */
  thumbnails: string[];
  /** Signature cards that exemplify this archetype */
  signatureCards?: SignatureCardEntry[];
  /**
   * Representative Pokémon icon slugs (Limitless sprites), e.g. ["dragapult", "dusknoir"].
   * Up to two. Rendered via `${ICON_BASE}/{slug}.png`. See ArchetypeIcons component.
   */
  icons?: string[];
}

/**
 * Tournament entry within meta report.
 */
interface MetaTournamentEntry {
  /** Tournament ID */
  id: string;
  /** Tournament name */
  name: string;
  /** Tournament date (ISO string) */
  date: string;
  /** Format (e.g., "STANDARD") */
  format?: string;
  /** Platform */
  platform?: string;
  /** Number of players */
  players?: number;
  /** Organizer name */
  organizer?: string;
}

/**
 * Tournament metadata report (meta.json).
 */
export interface MetaReport {
  /** Report/folder name */
  name: string;
  /** Data source identifier */
  source: string;
  /** Generation timestamp (ISO string) */
  generatedAt: string;
  /** Start of data window (ISO string) */
  windowStart: string;
  /** End of data window (ISO string) */
  windowEnd: string;
  /** Total decks analyzed */
  deckTotal: number;
  /** Number of tournaments */
  tournamentCount: number;
  /** Minimum archetype percentage threshold */
  archetypeMinPercent?: number;
  /** Minimum archetype deck count threshold */
  archetypeMinDecks?: number;
  /** Tournaments in this report */
  tournaments: MetaTournamentEntry[];
}

// =============================================================================
// Filter Types
// =============================================================================

// Deck and filter domain types moved to shared/deckTypes (used by Pages
// Functions and pipeline code as well); re-exported here so frontend imports
// keep working unchanged.
export type { Deck, DeckCard, Operator, Filter, ArchetypeFilterRequest } from '../../shared/deckTypes.js';
