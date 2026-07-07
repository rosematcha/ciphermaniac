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
 * Card within a deck list.
 * Represents a single card entry with count information.
 */
export interface DeckCard {
  /** Card name */
  name?: string;
  /** Set code */
  set?: string;
  /** Collector number */
  number?: string | number;
  /** Number of copies in the deck */
  count?: number;
  /** Alternative field for number of copies */
  copies?: number;
  /** Card category */
  category?: string;
  /** Trainer subtype */
  trainerType?: string;
  /** Energy subtype */
  energyType?: string;
  /** Whether this is an Ace Spec card */
  aceSpec?: boolean;
  /** Pokemon TCG supertype */
  supertype?: string;
  /** Regulation mark (e.g., "G", "H", "I") for format legality */
  regulationMark?: string;
  /** Unique identifier */
  uid?: string;
}

// =============================================================================
// Deck-Related Types
// =============================================================================

/**
 * Complete deck representation from tournament data.
 * Contains player info, placement, and card list.
 */
export interface Deck {
  /** Unique deck identifier */
  id?: string;
  /** Alternative deck ID field */
  deckId?: string;
  /** Hash of deck contents for deduplication */
  deckHash?: string;
  /** URL-friendly slug */
  slug?: string;
  /** Archetype name (e.g., "Gholdengo", "Charizard ex") */
  archetype?: string;
  /** Archetype ID from source */
  archetypeId?: string | null;
  /** Cards in the deck (primary field) */
  cards?: DeckCard[];
  /** Cards in the deck (alternative field name) */
  deck?: DeckCard[];
  /** Success/placement tags (e.g., ["winner", "top8"]) */
  successTags?: string[];
  /** Tournament placement (1st, 2nd, etc.) */
  placement?: number | string;
  /** Alternative field for placement */
  placing?: number | string;
  /** Number of players in the tournament */
  tournamentPlayers?: number | string;
  /** Alternative field for player count */
  players?: number | string;
  /** Tournament identifier */
  tournamentId?: string;
  /** Tournament display name */
  tournamentName?: string;
  /** Tournament date */
  tournamentDate?: string;
  /** Tournament format (e.g., "STANDARD") */
  tournamentFormat?: string;
  /** Tournament platform */
  tournamentPlatform?: string;
  /** Tournament organizer */
  tournamentOrganizer?: string;
  /** Player name */
  player?: string;
  /** Player ID */
  playerId?: string | null;
  /** Player country code */
  country?: string | null;
  /** Source of deck data */
  deckSource?: string;
  /** Whether player reached phase 2/day 2 */
  madePhase2?: boolean;
  /** Whether player reached top cut */
  madeTopCut?: boolean;
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

/**
 * Comparison operators for quantity filtering.
 */
export type Operator = '=' | '<' | '<=' | '>' | '>=' | 'any' | '';

/**
 * Filter descriptor for card filtering.
 */
export interface Filter {
  /** Card identifier (SET~NUMBER format) */
  cardId: string;
  /** Comparison operator */
  operator?: Operator | null;
  /** Count threshold for comparison */
  count?: number | null;
}

/**
 * Request payload for server-side archetype filter reports.
 */
export interface ArchetypeFilterRequest {
  tournament: string;
  archetype: string;
  successFilter: string;
  filters: Filter[];
  slice?: 'all' | 'phase2' | 'topcut';
}

/**
 * Placement rule for determining success tags.
 */
export interface PlacementRule {
  /** Tag name (e.g., "winner", "top8") */
  tag: string;
  /** Maximum placement to qualify */
  maxPlacing: number;
  /** Minimum tournament size to apply this rule */
  minPlayers: number;
}

/**
 * Percentile-based placement rule.
 */
export interface PercentRule {
  /** Tag name (e.g., "top10", "top25") */
  tag: string;
  /** Fraction of field (0.1 = top 10%) */
  fraction: number;
  /** Minimum tournament size to apply this rule */
  minPlayers: number;
}
