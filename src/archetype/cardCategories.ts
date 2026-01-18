/**
 * Card category inference and sorting utilities for archetype pages.
 * These functions determine card categories (Pokemon/Trainer/Energy) and
 * trainer subtypes (Supporter/Item/Tool/Stadium) based on card properties.
 */

/**
 * Minimal card data needed for category inference.
 */
export interface CardForCategory {
  name?: string;
  uid?: string;
  category?: string;
  trainerType?: string;
  energyType?: string;
  aceSpec?: boolean;
  found?: number;
  total?: number;
  pct?: number;
}

// ============================================================================
// Trainer Classification Constants
// ============================================================================

/**
 * Known supporter names that should always be classified as supporters.
 */
export const TRAINER_SUPPORTER_OVERRIDES = new Set([
  'iono',
  'arven',
  'penny',
  'briar',
  'crispin',
  'cyrano',
  'jacq',
  'clavell',
  'hilda',
  'hop',
  'n',
  'cynthia',
  'guzma',
  'melony',
  'nessa',
  'grant',
  'irida',
  'adaman',
  'raihan',
  'rika',
  'mela',
  'peonia',
  'peony',
  'shauna',
  'rosa',
  'hilbert',
  'gloria',
  'selene',
  'gladion',
  'grimsley',
  'volo',
  'lucian',
  'gardenia',
  'clair',
  'clay',
  'bede',
  'katie',
  'sparky'
]);

/**
 * Keywords that indicate a card is a Supporter.
 */
export const TRAINER_SUPPORTER_KEYWORDS = [
  "professor'",
  'professor ',
  "boss's orders",
  'boss\u2019s orders',
  'orders',
  'judge',
  'research',
  'scenario',
  'vitality',
  'assistant',
  'team star',
  'team rocket',
  'gym leader',
  "n's ",
  'n\u2019s '
];

/**
 * Keywords that indicate a card is a Stadium.
 */
export const TRAINER_STADIUM_KEYWORDS = [
  ' stadium',
  ' arena',
  ' park',
  ' tower',
  ' city',
  ' town',
  ' plaza',
  ' hq',
  ' headquarters',
  ' laboratory',
  ' lab',
  ' factory',
  ' ruins',
  ' temple',
  ' beach',
  ' garden',
  ' library',
  ' forest',
  ' village',
  ' court',
  ' academy',
  ' grand tree',
  ' jamming tower',
  ' artazon',
  ' mesagoza',
  ' levincia',
  ' area zero',
  ' dojo',
  ' mine',
  ' depot',
  ' square',
  ' colosseum',
  ' hall',
  ' palace',
  ' lake',
  ' mountain',
  ' hideout',
  ' cave'
];

/**
 * Keywords that indicate a card is a Tool.
 */
export const TRAINER_TOOL_KEYWORDS = [
  ' belt',
  ' band',
  ' cape',
  ' mask',
  ' goggles',
  ' boots',
  ' helmet',
  ' gloves',
  ' shield',
  ' vest',
  ' charm',
  ' stone',
  ' tablet',
  ' capsule',
  ' scope',
  ' cloak',
  ' glasses',
  ' amplifier',
  ' weight',
  ' booster',
  ' anklet'
];

/**
 * Keywords that indicate a card is an Item.
 */
export const TRAINER_ITEM_KEYWORDS = [
  ' ball',
  ' switch',
  ' rope',
  ' catcher',
  ' rod',
  ' capsule',
  ' tablet',
  ' candy',
  ' vessel',
  ' bag',
  ' phone',
  ' transceiver',
  ' generator',
  ' pass',
  ' gear',
  ' pad',
  ' vacuum',
  ' machine',
  ' pickaxe',
  ' basket',
  ' hammer',
  ' letter',
  ' map',
  ' board',
  ' pouch',
  ' poffin',
  ' incense',
  ' cart',
  ' camera',
  ' shoes',
  ' energy search',
  'energy switch',
  'energy recycler',
  'energy retrieval',
  'technical machine'
];

/**
 * Combined trainer hint keywords.
 */
export const TRAINER_HINT_KEYWORDS = [
  ...TRAINER_SUPPORTER_KEYWORDS,
  ...TRAINER_STADIUM_KEYWORDS,
  ...TRAINER_TOOL_KEYWORDS,
  ...TRAINER_ITEM_KEYWORDS,
  ' trainer',
  'orders',
  'supporter'
];

/**
 * Priority order for card categories when sorting.
 */
export const CARD_CATEGORY_SORT_PRIORITY = new Map([
  ['pokemon', 0],
  ['trainer/supporter', 1],
  ['trainer/item', 2],
  ['trainer/tool/acespec', 3],
  ['trainer/tool', 4],
  ['trainer/stadium', 5],
  ['trainer/other', 6],
  ['trainer', 6],
  ['energy/basic', 7],
  ['energy/special', 8],
  ['energy', 7]
]);

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Convert value to lowercase string.
 */
/**
 * Normalize a value to lowercase string.
 * @param value - Input value.
 */
export function toLower(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase() : '';
}

/**
 * Normalize a category value for comparison.
 */
/**
 * Normalize category values for comparison.
 * @param value - Input value.
 */
export function normalizeCategoryValue(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    return '';
  }
  return value.trim().toLowerCase().replace(/\\/g, '/');
}

// ============================================================================
// Category Inference Functions
// ============================================================================

/**
 * Infer the primary category (pokemon/trainer/energy) from card data.
 */
/**
 * Infer the primary category for a card.
 * @param card - Card data.
 */
export function inferPrimaryCategory(card: CardForCategory | null | undefined): string {
  const direct = normalizeCategoryValue(card?.category);
  if (direct) {
    const [base] = direct.split(/[/-]/);
    if (base === 'pokemon' || base === 'trainer' || base === 'energy') {
      return base;
    }
  }

  if (card?.trainerType) {
    return 'trainer';
  }
  if (card?.energyType) {
    return 'energy';
  }

  const name = toLower(card?.name);
  const uid = toLower(card?.uid);

  if (name && TRAINER_HINT_KEYWORDS.some(keyword => name.includes(keyword))) {
    return 'trainer';
  }
  if (uid && TRAINER_HINT_KEYWORDS.some(keyword => uid.includes(keyword))) {
    return 'trainer';
  }

  const endsWithEnergy = name && name.endsWith(' energy');
  if (endsWithEnergy) {
    return 'energy';
  }
  if (!endsWithEnergy && uid && (uid.endsWith(' energy') || uid.includes(' energy::'))) {
    return 'energy';
  }
  if (name && name.includes(' energy ') && !TRAINER_HINT_KEYWORDS.some(keyword => name.includes(keyword))) {
    return 'energy';
  }

  return 'pokemon';
}

/**
 * Infer trainer subtype (supporter/item/tool/stadium) from card data.
 */
/**
 * Infer the trainer subtype for a card.
 * @param card - Card data.
 */
export function inferTrainerSubtype(card: CardForCategory | null | undefined): string {
  const trainerType = toLower(card?.trainerType);
  if (trainerType) {
    return trainerType;
  }

  const name = toLower(card?.name);
  const uid = toLower(card?.uid);

  if (TRAINER_SUPPORTER_OVERRIDES.has(name) || TRAINER_SUPPORTER_OVERRIDES.has(uid)) {
    return 'supporter';
  }
  if (name.startsWith('technical machine') || uid.includes('technical_machine')) {
    return 'item';
  }
  if (name.includes('ace spec') || uid.includes('ace_spec')) {
    return 'ace-spec';
  }
  if (
    TRAINER_STADIUM_KEYWORDS.some(keyword => name.includes(keyword)) ||
    TRAINER_STADIUM_KEYWORDS.some(keyword => uid.includes(keyword))
  ) {
    return 'stadium';
  }
  if (
    TRAINER_TOOL_KEYWORDS.some(keyword => name.includes(keyword)) ||
    TRAINER_TOOL_KEYWORDS.some(keyword => uid.includes(keyword))
  ) {
    return 'tool';
  }
  if (
    TRAINER_SUPPORTER_KEYWORDS.some(keyword => name.includes(keyword)) ||
    TRAINER_SUPPORTER_KEYWORDS.some(keyword => uid.includes(keyword))
  ) {
    return 'supporter';
  }
  if (
    TRAINER_ITEM_KEYWORDS.some(keyword => name.includes(keyword)) ||
    TRAINER_ITEM_KEYWORDS.some(keyword => uid.includes(keyword))
  ) {
    return 'item';
  }

  return '';
}

/**
 * Build category slug for trainer cards.
 */
/**
 * Build a trainer category slug for filtering.
 * @param card - Card data.
 * @param baseCategory - Base category slug.
 */
export function buildTrainerCategorySlug(card: CardForCategory | null | undefined, baseCategory: string): string {
  if (baseCategory !== 'trainer') {
    return '';
  }

  const parts = ['trainer'];
  const trainerType = inferTrainerSubtype(card);
  const normalizedTrainerType = trainerType === 'ace-spec' ? 'tool' : trainerType;

  if (normalizedTrainerType) {
    parts.push(normalizedTrainerType);
  }

  const hasAceSpec = Boolean(card?.aceSpec) || trainerType === 'ace-spec';
  if (hasAceSpec) {
    if (!parts.includes('tool')) {
      parts.push('tool');
    }
    parts.push('acespec');
  }

  return parts.join('/');
}

/**
 * Build category slug for energy cards.
 */
/**
 * Build an energy category slug for filtering.
 * @param card - Card data.
 * @param baseCategory - Base category slug.
 */
export function buildEnergyCategorySlug(card: CardForCategory | null | undefined, baseCategory: string): string {
  if (baseCategory !== 'energy') {
    return '';
  }
  const energyType = toLower(card?.energyType);
  return energyType ? `energy/${energyType}` : 'energy';
}

/**
 * Derive full category slug from card data.
 */
/**
 * Derive a category slug from card metadata.
 * @param card - Card data.
 */
export function deriveCategorySlug(card: CardForCategory | null | undefined): string {
  const direct = normalizeCategoryValue(card?.category);
  if (direct) {
    if (direct.startsWith('trainer') && !direct.includes('/')) {
      return buildTrainerCategorySlug(card, 'trainer') || direct;
    }
    if (direct.startsWith('energy') && !direct.includes('/')) {
      return buildEnergyCategorySlug(card, 'energy') || direct;
    }
    return direct;
  }

  const baseCategory = inferPrimaryCategory(card);
  if (baseCategory === 'trainer') {
    return buildTrainerCategorySlug(card, baseCategory) || 'trainer';
  }
  if (baseCategory === 'energy') {
    return buildEnergyCategorySlug(card, baseCategory) || 'energy';
  }

  return baseCategory || 'pokemon';
}

/**
 * Get sort weight for a category (lower = higher priority).
 */
/**
 * Get a numeric sort weight for a category slug.
 * @param category - Category slug.
 */
export function getCategorySortWeight(category: string | undefined): number {
  if (!category) {
    return 999;
  }
  const normalizedCategory = normalizeCategoryValue(category);
  if (CARD_CATEGORY_SORT_PRIORITY.has(normalizedCategory)) {
    return CARD_CATEGORY_SORT_PRIORITY.get(normalizedCategory)!;
  }

  // Fallback: infer from prefix
  if (normalizedCategory.startsWith('pokemon')) {
    return 0;
  }
  if (normalizedCategory.startsWith('trainer')) {
    return 6;
  }
  if (normalizedCategory.startsWith('energy')) {
    return 7;
  }
  return 999;
}

/**
 * Get usage percentage from a card.
 */
/**
 * Get usage percent from card metadata.
 * @param card - Card data.
 */
export function getUsagePercent(card: CardForCategory | null | undefined): number {
  if (!card) {
    return 0;
  }
  if (typeof card.pct === 'number' && Number.isFinite(card.pct)) {
    return card.pct;
  }
  if (Number.isFinite(card.found) && Number.isFinite(card.total) && card.total! > 0) {
    return (card.found! / card.total!) * 100;
  }
  return 0;
}

// ============================================================================
// Ace Spec Detection
// ============================================================================

/**
 * Known Ace Spec card names/keywords.
 */
export const ACE_SPEC_KEYWORDS = [
  'ace spec',
  'amulet of hope',
  'awakening drum',
  'brilliant blender',
  'computer search',
  'crystal edge',
  'crystal wall',
  'dangerous laser',
  'deluxe bomb',
  'dowsing machine',
  'energy search pro',
  'enriching energy',
  'g booster',
  'g scope',
  'gold potion',
  'grand tree',
  "hero's cape",
  'hyper aroma',
  'legacy energy',
  'life dew',
  'master ball',
  'max rod',
  'maximum belt',
  'megaton blower',
  'miracle headset',
  'neo upper energy',
  'neutralization zone',
  'poke vital a',
  'precious trolley',
  'prime catcher',
  'reboot pod',
  'rock guard',
  'scoop up cyclone',
  'scramble switch',
  'secret box',
  'sparkling crystal',
  'survival brace',
  'treasure tracker',
  'unfair stamp',
  'victory piece'
];

/**
 * Check if a card name indicates it's an Ace Spec card.
 */
/**
 * Check if a card name indicates an ACE SPEC.
 * @param cardName - Card name.
 */
export function isAceSpec(cardName: string | null | undefined): boolean {
  const lowerName = (cardName || '').toLowerCase();
  return ACE_SPEC_KEYWORDS.some(keyword => lowerName.includes(keyword));
}
