export interface ParsedCardPage {
  metadataVersion: number;
  cardType: string;
  subType: string | null;
  evolutionInfo: string | null;
  fullType: string;
  aceSpec?: true;
  regulationMark?: string;
  abilities?: string[];
  attacks?: string[];
  hp?: number;
  pokemonType?: string;
  weakness?: string;
  resistance?: string;
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

export function parseCardPage(html: string): ParsedCardPage | null;
