import type { ArchetypeIdentity } from '../archetypes/identity';

export const SCHEMA_VERSION = 1;

export type NormalizedEventKind = 'labs-event' | 'online-window';

export type CardCategory = 'pokemon' | 'trainer' | 'energy';

export const CARD_CATEGORIES: readonly CardCategory[] = ['pokemon', 'trainer', 'energy'];

export type TrainerType = 'supporter' | 'item' | 'stadium' | 'tool';

export type EnergyType = 'basic' | 'special';

export type CardStage = 'basic' | 'stage1' | 'stage2' | 'vstar' | 'vmax' | 'levelUp';

export const CARD_STAGES: readonly CardStage[] = ['basic', 'stage1', 'stage2', 'vstar', 'vmax', 'levelUp'];

export type CardMechanicSubtype = 'Mega' | 'Tera' | 'Radiant' | 'ex' | 'VMAX' | 'VSTAR' | 'V';

export const CARD_MECHANIC_SUBTYPES: readonly CardMechanicSubtype[] = [
  'Mega',
  'Tera',
  'Radiant',
  'ex',
  'VMAX',
  'VSTAR',
  'V'
];

export type MatchOutcome = 'decided' | 'tie' | 'double_loss' | 'bye' | 'unpaired' | 'unknown';

export const MATCH_OUTCOMES: readonly MatchOutcome[] = ['decided', 'tie', 'double_loss', 'bye', 'unpaired', 'unknown'];

export interface CardIdentity {
  uid: string;
  name: string;
  set: string | null;
  number: string | null;
}

export interface CardPrinting {
  uid: string;
  name: string;
  set: string;
  number: string;
}

export interface DeckCard {
  canonical: CardIdentity;
  printings: CardPrinting[];
  count: number;
  category: CardCategory;
  trainerType?: TrainerType | null;
  energyType?: EnergyType | null;
  aceSpec?: boolean;
  regulationMark?: string | null;
}

export interface WeaknessResistance {
  type: string;
  modifier: string | null;
}

export interface CardAbilityDetail {
  name: string;
  effect: string | null;
}

export interface CardAttackDetail {
  cost: string | null;
  name: string;
  damage: string | null;
  effect: string | null;
}

export interface CardRecord {
  metadataVersion: number;
  cardType: CardCategory;
  subType?: string | null;
  evolutionInfo?: string | null;
  fullType: string;
  stage?: CardStage;
  mechanicSubtypes?: CardMechanicSubtype[];
  aceSpec?: true;
  regulationMark?: string;
  abilities?: string[];
  attacks?: string[];
  hp?: number;
  pokemonType?: string;
  weakness?: WeaknessResistance;
  resistance?: WeaknessResistance;
  retreatCost?: number;
  rarity?: string;
  artist?: string;
  text?: string;
  abilityDetails?: CardAbilityDetail[];
  attackDetails?: CardAttackDetail[];
  legality?: Record<string, string>;
  lastUpdated?: string;
}

export type { ArchetypeIdentity };

export interface ParticipantRecord {
  wins: number;
  losses: number;
  ties: number;
}

export interface ParticipantFlags {
  madePhase2: boolean;
  madeTopCut: boolean;
  dropped: boolean;
  dqed: boolean;
  late: boolean;
  decklistPublished: boolean;
}

export interface Participant {
  participantId: string;
  playerRef: string | null;
  name: string;
  country: string | null;
  placement: number | null;
  record: ParticipantRecord;
  opwPct: number | null;
  oopwPct: number | null;
  points?: number | null;
  icons?: string[];
  dropRound?: number | null;
  labsDeckId?: string | null;
  deckName?: string | null;
  flags: ParticipantFlags;
  deckId: string | null;
}

export interface Deck {
  schemaVersion: number;
  deckId: string;
  participantId: string;
  playerRef: string | null;
  archetype: ArchetypeIdentity;
  cards: DeckCard[];
  hasDecklist: boolean;
  successTags: string[];
}

export interface Match {
  schemaVersion: number;
  matchId: string;
  round: number;
  phase: number;
  table: number | null;
  participantIds: string[];
  outcome: MatchOutcome;
  winnerParticipantId: string | null;
  completed: boolean;
}

export interface SourceRevision {
  source: string;
  entityId: string;
  sourceHash: string;
  fetchedAt: string;
}

export interface EventMeta {
  name: string;
  date: string;
  playerCount: number;
  format: string | null;
  division: string | null;
  hasDay2: boolean;
  windowStart?: string | null;
  windowEnd?: string | null;
  country?: string | null;
  city?: string | null;
  eventType?: string | null;
  updatedAt?: string | null;
  completed?: boolean;
  started?: boolean;
  playersRound1?: number | null;
  decklistCount?: number | null;
  rk9Id?: string | null;
  playlatamId?: string | null;
  labsCode?: string | null;
  sourceTournamentId?: string | null;
}

export interface NormalizedEvent {
  schemaVersion: number;
  eventId: string;
  kind: NormalizedEventKind;
  meta: EventMeta;
  participants: Participant[];
  decks: Deck[];
  matches: Match[];
  sourceRevisions: SourceRevision[];
}
