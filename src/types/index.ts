export interface CardDistributionEntry {
  copies?: number;
  players?: number;
  percent?: number;
}

export interface CardItem {
  rank?: number;
  name: string;
  /** Unique identifier in format "Name::SET::NUMBER" */
  uid?: string;
  set?: string;
  number?: string | number;
  /** Category path (e.g., "pokemon", "trainer/supporter", "energy/basic") */
  category?: string;
  trainerType?: string;
  energyType?: string;
  aceSpec?: boolean;
  supertype?: string;
  regulationMark?: string;
  found: number;
  total: number;
  pct: number;
  dist?: CardDistributionEntry[];
  price?: number | null;
}

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

export type {
  PlayerDeckCard,
  PlayerDecks,
  PlayerIndexEntry,
  PlayerIndexSlimEntry,
  PlayerProfile,
  PlayerTournamentEntry
} from '../../shared/playerTypes.js';

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

interface TournamentReport {
  deckTotal: number;
  items: CardItem[];
  generatedClientSide?: boolean;
  raw?: {
    generatedClientSide: true;
    filterCount: number;
  };
}

export interface ArchetypeReport extends TournamentReport {
  items: (CardItem & {
    deckInstances?: Array<{ deckId: string; count: number; archetype?: string }>;
  })[];
}

interface SignatureCardEntry {
  name: string;
  set: string | null;
  number: string | null;
  pct: number;
}

export interface ArchetypeIndexEntry {
  name: string;
  label: string;
  deckCount: number | null;
  percent: number | null;
  thumbnails: string[];
  signatureCards?: SignatureCardEntry[];
  /** At most two Limitless sprite slugs. */
  icons?: string[];
}

interface MetaTournamentEntry {
  id: string;
  name: string;
  date: string;
  format?: string;
  platform?: string;
  players?: number;
  organizer?: string;
}

export interface MetaReport {
  name: string;
  source: string;
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  deckTotal: number;
  tournamentCount: number;
  archetypeMinPercent?: number;
  archetypeMinDecks?: number;
  tournaments: MetaTournamentEntry[];
}

export type { Deck, DeckCard } from '../../shared/deckTypes.js';
