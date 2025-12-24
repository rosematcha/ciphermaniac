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
}

// =============================================================================
// Report Types
// =============================================================================

/**
 * Tournament report containing aggregated card data.
 * This is the main report structure for tournaments and archetypes.
 */
export interface TournamentReport {
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
 * Parsed report after validation and cleaning.
 */
export interface ParsedReport {
  /** Total number of decks */
  deckTotal: number;
  /** Validated and cleaned card items */
  items: CardItem[];
}

/**
 * Signature card entry for archetype display.
 * These are cards that best exemplify the archetype.
 */
export interface SignatureCardEntry {
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
}

/**
 * Tournament entry within meta report.
 */
export interface MetaTournamentEntry {
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
// Trend Report Types
// =============================================================================

/**
 * Single data point in a trend timeline.
 */
export interface TrendDataPoint {
  /** Date string (ISO format or YYYY-MM-DD) */
  date: string;
  /** Usage share percentage */
  share: number;
  /** Number of decks */
  decks?: number;
  /** Total decks in the sample */
  totalDecks?: number;
  /** Success counts by tag */
  success?: Record<string, number>;
}

/**
 * Archetype trend series for time-series visualization.
 */
export interface TrendSeries {
  /** Base archetype name (URL-safe) */
  base: string;
  /** Human-readable display name */
  displayName: string;
  /** Total decks across all time points */
  totalDecks: number;
  /** Number of tournaments where archetype appeared */
  appearances: number;
  /** Average meta share percentage */
  avgShare: number;
  /** Maximum meta share percentage */
  maxShare: number;
  /** Peak share (alias for maxShare) */
  peakShare?: number;
  /** Minimum meta share percentage */
  minShare: number;
  /** Aggregate success counts by tag */
  successTotals: Record<string, number>;
  /** Timeline of data points */
  timeline: TrendDataPoint[];
}

/**
 * Card trend data for rising/falling analysis.
 */
export interface CardTrendEntry {
  /** Card identifier key */
  key: string;
  /** Card name */
  name: string;
  /** Set code */
  set: string | null;
  /** Collector number */
  number: string | null;
  /** Number of tournament appearances */
  appearances: number;
  /** Starting share percentage */
  startShare: number;
  /** Ending share percentage */
  endShare: number;
  /** Change in share (endShare - startShare) */
  delta: number;
  /** Current/latest share percentage */
  currentShare: number;
}

/**
 * Card trends report with rising and falling cards.
 */
export interface CardTrendsReport {
  /** Generation timestamp */
  generatedAt: string;
  /** Start of analysis window */
  windowStart: string | null;
  /** End of analysis window */
  windowEnd: string | null;
  /** Number of cards analyzed */
  cardsAnalyzed: number;
  /** Minimum appearances threshold */
  minAppearances: number;
  /** Number of top cards to include */
  topCount: number;
  /** Cards with increasing usage */
  rising: CardTrendEntry[];
  /** Cards with decreasing usage */
  falling: CardTrendEntry[];
}

/**
 * Complete trend report for a tournament group.
 */
export interface TrendReport {
  /** Generation timestamp */
  generatedAt: string;
  /** Start of analysis window */
  windowStart: string | null;
  /** End of analysis window */
  windowEnd: string | null;
  /** Total decks analyzed */
  deckTotal: number;
  /** Number of tournaments in the window */
  tournamentCount: number;
  /** Minimum appearances for inclusion */
  minAppearances: number;
  /** Number of archetypes included */
  archetypeCount: number;
  /** Archetype trend series */
  series: TrendSeries[];
  /** Tournament list with deck counts */
  tournaments: Array<{
    id: string;
    name: string;
    date: string;
    deckTotal?: number;
    players?: number;
    format?: string;
  }>;
  /** Total archetypes before filtering (if limited) */
  totalArchetypes?: number;
  /** Card-level trends */
  cardTrends?: CardTrendsReport;
}

/**
 * Suggestion entry for trend analysis (leaders, rising, falling cards).
 */
export interface SuggestionEntry {
  /** Card identifier key */
  key: string;
  /** Card name */
  name: string;
  /** Set code */
  set: string | null;
  /** Collector number */
  number: string | null;
  /** Primary archetype using this card */
  archetype: string | null;
  /** Latest share percentage */
  latest?: number;
  /** Average share percentage */
  avgShare?: number;
  /** Recent average share */
  recentAvg?: number;
  /** Absolute delta change */
  deltaAbs?: number;
  /** Relative delta change */
  deltaRel?: number;
  /** Trend slope */
  slope?: number;
  /** Ranking score */
  score?: number;
  /** Peak share percentage */
  peakShare?: number;
  /** Absolute drop from peak */
  absDrop?: number;
  /** Relative drop from peak */
  relDrop?: number;
  /** Maximum usage */
  maxUsage?: number;
  /** Total usage sum */
  totalUsage?: number;
}

/**
 * Card suggestions for trend visualization.
 */
export interface TrendSuggestions {
  /** Cards with consistent high usage */
  leaders: SuggestionEntry[];
  /** Cards with increasing usage */
  onTheRise: SuggestionEntry[];
  /** Cards that have fallen from prominence */
  choppedAndWashed: SuggestionEntry[];
  /** Cards with brief appearances ("that Day 2'd") */
  thatDay2d?: SuggestionEntry[];
}

/**
 * Full payload returned by trends.json endpoint.
 * Contains the trend report, card trends, and suggestions.
 */
export interface TrendReportPayload {
  /** Archetype trend report */
  trendReport: TrendReport;
  /** Card-level trends */
  cardTrends: CardTrendsReport | null;
  /** Card suggestions for visualization */
  suggestions: TrendSuggestions | null;
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

// =============================================================================
// API Response Types
// =============================================================================

/**
 * Limitless API response wrapper.
 */
export interface LimitlessResponse {
  /** Whether the request was successful */
  success: boolean;
  /** Response data payload */
  data: unknown[];
}

/**
 * Limitless tournament summary from API.
 */
export interface LimitlessTournament {
  /** Tournament ID */
  id: string;
  /** Tournament name */
  name: string;
  /** Game type (e.g., "PTCG") */
  game: string | null;
  /** Format (e.g., "STANDARD") */
  format: string | null;
  /** Tournament date (ISO string) */
  date: string | null;
  /** Number of players */
  players: number | null;
  /** Data source identifier */
  source: 'limitless';
}

/**
 * Pricing data response.
 */
export interface PricingData {
  /** Map of card IDs to pricing info */
  cardPrices: Record<string, { price?: number; tcgPlayerId?: string }>;
}

// =============================================================================
// App State Types
// =============================================================================

/**
 * Sort option for card grid.
 */
export interface SortOption {
  /** Sort key identifier */
  key: 'percent-desc' | 'percent-asc' | 'alpha-asc' | 'alpha-desc' | 'price-desc' | 'price-asc';
  /** Human-readable label */
  label: string;
  /** Comparison function for sorting */
  compareFn: (a: CardItem, b: CardItem) => number;
}

/**
 * Cache entry for API responses.
 */
export interface CacheEntry<T = unknown> {
  /** Cached data (if resolved) */
  data?: T;
  /** Pending promise (if in-flight) */
  promise?: Promise<T>;
  /** Expiration timestamp */
  expiresAt: number;
}

/**
 * Render options for the card grid.
 */
export interface RenderOptions {
  /** Layout mode ('standard' | 'compact') */
  layoutMode?: 'standard' | 'compact';
  /** Whether to show price badges */
  showPrice?: boolean;
}

/**
 * Card lookup entry for filtering.
 */
export interface CardLookupEntry {
  /** Card identifier */
  id: string;
  /** Card name */
  name: string;
  /** Set code */
  set: string | null;
  /** Collector number */
  number: string | null;
  /** Decks containing this card */
  found: number;
  /** Total decks analyzed */
  total: number;
  /** Usage percentage */
  pct: number;
  /** Whether card is in 100% of decks */
  alwaysIncluded: boolean;
  /** Card category */
  category: string | null;
  /** Energy type (for energy cards) */
  energyType: string | null;
}

/**
 * Filter row state for multi-filter UI.
 */
export interface FilterRowState {
  /** Unique row identifier */
  id: number;
  /** Selected card ID */
  cardId: string | null;
  /** Selected operator */
  operator: Operator | null;
  /** Count value */
  count: number | null;
  /** DOM element references */
  elements: {
    cardSelect: HTMLSelectElement;
    operatorSelect: HTMLSelectElement;
    countInput: HTMLInputElement;
    removeButton: HTMLButtonElement;
    container: HTMLElement;
  };
}

// =============================================================================
// Archetype Trends Page Types (from archetypeTrends.ts)
// =============================================================================

/**
 * Trends metadata from the trends.json file.
 */
export interface TrendsMeta {
  /** Generation timestamp */
  generatedAt: string;
  /** Number of tournaments analyzed */
  tournamentCount: number;
  /** Number of unique cards tracked */
  cardCount: number;
}

/**
 * Tournament totals by performance tier.
 */
export interface TournamentTotals {
  /** All decks in tournament */
  all: number;
  /** Winner count */
  winner?: number;
  /** Top 2 count */
  top2?: number;
  /** Top 4 count */
  top4?: number;
  /** Top 8 count */
  top8?: number;
  /** Top 16 count */
  top16?: number;
  /** Top 10% count */
  top10?: number;
  /** Top 25% count */
  top25?: number;
  /** Top 50% count */
  top50?: number;
}

/**
 * Tournament entry in trends data.
 */
export interface TournamentEntry {
  /** Tournament ID */
  id: string;
  /** Tournament date */
  date: string;
  /** Tournament name */
  name: string;
  /** Deck counts by tier */
  totals: TournamentTotals;
}

/**
 * Card timeline data for archetype trends.
 */
export interface CardTimeline {
  /** Map of tournament ID to tier data */
  [tournamentId: string]: {
    /** Map of tier to [includedCount, avgCopies] */
    [tier: string]: [number, number];
  };
}

/**
 * Card entry in archetype trends data.
 */
export interface CardTrendTimelineEntry {
  /** Card name */
  name: string;
  /** Set code */
  set: string | null;
  /** Collector number */
  number: string | null;
  /** Timeline data by tournament and tier */
  timeline: CardTimeline;
}

/**
 * Complete archetype trends data structure.
 */
export interface ArchetypeTrendsData {
  /** Report metadata */
  meta: TrendsMeta;
  /** Tournament list */
  tournaments: TournamentEntry[];
  /** Card data keyed by UID */
  cards: Record<string, CardTrendTimelineEntry>;
}

/**
 * Daily aggregated point for trend charts.
 */
export interface DailyPoint {
  /** Date string (YYYY-MM-DD) */
  date: string;
  /** Usage share percentage */
  share: number;
  /** Average copies per deck */
  copies: number;
  /** Number of decks using this card */
  count: number;
  /** Total decks in sample */
  total: number;
}

/**
 * Chart line data for trend visualization.
 */
export interface ChartLine {
  /** Card UID */
  uid: string;
  /** Card name */
  name: string;
  /** Line color (hex) */
  color: string;
  /** Data points */
  points: DailyPoint[];
  /** Latest share value */
  latestShare: number;
  /** Latest copies value */
  latestCopies: number;
  /** Change from first to last point */
  delta: number;
  /** Linear regression slope for trend direction */
  slope: number;
}

/**
 * Card row data for trends table.
 */
export interface CardRowData {
  /** Card UID */
  uid: string;
  /** Card name */
  name: string;
  /** Set code */
  set: string | null;
  /** Collector number */
  number: string | null;
  /** Latest share percentage */
  latestShare: number;
  /** Latest average copies */
  latestCopies: number;
  /** Change from start to end */
  delta: number;
  /** Trend slope */
  slope: number;
  /** Points for sparkline */
  sparklinePoints: DailyPoint[];
  /** Number of data points */
  dataPoints: number;
}
