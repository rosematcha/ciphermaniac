/**
 * Card type inference heuristics for server-side processing
 * These mirror client-side logic to keep categories consistent.
 * @module lib/cardTypeInference
 */

// Ace Spec card name keywords
const ACE_SPEC_KEYWORDS = [
  'ace spec',
  'prime catcher',
  'reboot pod',
  'legacy energy',
  'enriching energy',
  'neo upper energy',
  'master ball',
  'secret box',
  'sparkling crystal',
  "hero's cape",
  'scramble switch',
  'dowsing machine',
  'computer search',
  'life dew',
  'scoop up cyclone',
  'gold potion',
  'victory piece',
  'g booster',
  'g scope',
  'g spirit',
  'crystal edge',
  'crystal wall',
  'rock guard',
  'surprise megaphone',
  'chaotic amplifier',
  'precious trolley',
  'poke vital a',
  'unfair stamp',
  'brilliant blender'
].map(k => k.toLowerCase());

/**
 * Check if a card name indicates an Ace Spec card
 * @param name - Card name
 * @returns True if the card appears to be an Ace Spec
 */
export function isAceSpecName(name: string | null | undefined): boolean {
  const normalized = String(name || '').toLowerCase();
  return ACE_SPEC_KEYWORDS.some(k => normalized.includes(k));
}

/**
 * Infer energy type from card name and set code
 * @param name - Card name
 * @param setCode - Set code (e.g., "SVE")
 * @returns Energy type: 'basic', 'special', or null
 */
export function inferEnergyType(name: string | null | undefined, setCode: string | null | undefined): string | null {
  // Basic Energy cards (SVE set)
  if ((setCode || '').toUpperCase() === 'SVE') {
    return 'basic';
  }

  // Check for basic energy type names
  const basicEnergyTypes = [
    'grass energy',
    'fire energy',
    'water energy',
    'lightning energy',
    'psychic energy',
    'fighting energy',
    'darkness energy',
    'metal energy',
    'fairy energy',
    'dragon energy',
    'basic energy'
  ];
  const lowerName = (name || '').toLowerCase().trim();
  if (basicEnergyTypes.includes(lowerName)) {
    return 'basic';
  }

  // Special Energy cards - "Energy" is always the last word but not a basic type
  if ((name || '').endsWith(' Energy')) {
    return 'special';
  }
  return null;
}

/**
 * Infer trainer subtype from card name
 * @param name - Card name
 * @returns Trainer type: 'stadium', 'tool', 'supporter', or 'item'
 */
export function inferTrainerType(name: string | null | undefined): string {
  const cardName = String(name || '');
  const lower = cardName.toLowerCase();

  // Stadiums often include these tokens explicitly
  if (
    cardName.includes('Stadium') ||
    cardName.includes('Tower') ||
    cardName.includes('Artazon') ||
    cardName.includes('Mesagoza') ||
    cardName.includes('Levincia')
  ) {
    return 'stadium';
  }

  // Tools typically have equipment-like words or TM
  const toolHints = [
    'tool',
    'belt',
    'helmet',
    'cape',
    'charm',
    'vest',
    'band',
    'mask',
    'glasses',
    'rescue board',
    'seal stone',
    'technical machine',
    'tm:'
  ];
  if (toolHints.some(hint => lower.includes(hint))) {
    return 'tool';
  }

  // Ace Specs override other trainer subtypes
  if (isAceSpecName(cardName)) {
    return 'tool';
  }

  // Common supporter indicators
  const supporterHints = [
    'professor',
    "boss's orders",
    'orders',
    'research',
    'judge',
    'scenario',
    'vitality',
    'grant',
    'roxanne',
    'miriam',
    'iono',
    'arven',
    'jacq',
    'penny',
    'briar',
    'carmine',
    'kieran',
    'geeta',
    'grusha',
    'ryme',
    'clavell',
    'giacomo'
  ];
  if (supporterHints.some(hint => lower.includes(hint))) {
    return 'supporter';
  }

  // Item catch-alls (keep broad; many trainers are items)
  const itemHints = [
    'ball',
    'rod',
    'catcher',
    'switch',
    'machine',
    'basket',
    'retrieval',
    'hammer',
    'potion',
    'stretcher',
    'vessel',
    'candy',
    'poffin',
    'powerglass',
    'energy search',
    'ultra ball'
  ];
  if (itemHints.some(hint => lower.includes(hint))) {
    return 'item';
  }

  // Default to item for unknown trainers
  return 'item';
}
