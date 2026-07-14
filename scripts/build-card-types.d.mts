export type CardStage = 'basic' | 'stage1' | 'stage2' | 'vstar' | 'vmax' | 'levelUp';

export type CardMechanicSubtype = 'Mega' | 'Tera' | 'Radiant' | 'ex' | 'VMAX' | 'VSTAR' | 'V';

export interface WeaknessResistance {
  type: string;
  modifier: string | null;
}

export interface ParsedCardPage {
  metadataVersion: number;
  cardType: string;
  subType: string | null;
  evolutionInfo: string | null;
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
  abilityDetails?: Array<{ name: string; effect: string | null }>;
  attackDetails?: Array<{
    cost: string | null;
    name: string;
    damage: string | null;
    effect: string | null;
  }>;
  legality?: Record<string, string>;
}

export const CARD_STAGES: CardStage[];
export const CARD_MECHANIC_SUBTYPES: readonly CardMechanicSubtype[];

export function parseCardPage(html: string): ParsedCardPage | null;
export function parseStage(evolutionInfo: string | null | undefined): CardStage | null;
export function parseMechanicSubtypes(name: string | null | undefined): CardMechanicSubtype[];
export function parseWeaknessResistance(value: string | null | undefined): WeaknessResistance | null;
export function restructureEntry(entry: Record<string, unknown>): Record<string, unknown>;
