/**
 * Hand-maintained archetype rules for formats whose decks Limitless leaves
 * unclassified (Eternal). A rule names an archetype by the cards it requires;
 * the first rule a deck satisfies wins, so specific rules go before broad ones.
 * @module shared/formats/archetypeRules
 */

/** One required card: a minimum count by name, optionally pinned to one print. */
interface RuleCard {
  card: string;
  /** `SET NUM`, for names shared by different cards (two Jirachi, two Zoroark). */
  print?: string;
  copies: number;
}

export interface ArchetypeRule {
  name: string;
  requires: RuleCard[];
  /** Card thumbnails, `SET/NUM`. */
  thumbnails: string[];
  /** Sprite slugs. */
  icons: string[];
}

/** The fields of a deck's card the rules read. */
interface RuleDeckCard {
  name: string;
  set: string | null;
  number: string | null;
  count: number;
}

function printKey(set: string, number: string): string {
  return `${set.toUpperCase()} ${number.replace(/^0+(?=.)/, '').toUpperCase()}`;
}

/** Copies per card name, and per name-and-print, across the deck. */
function tally(cards: readonly RuleDeckCard[]): Map<string, number> {
  const counts = new Map<string, number>();
  const add = (key: string, count: number) => counts.set(key, (counts.get(key) ?? 0) + count);
  for (const card of cards) {
    add(card.name, card.count);
    if (card.set && card.number) {
      add(`${card.name}@${printKey(card.set, card.number)}`, card.count);
    }
  }
  return counts;
}

function ruleKey(card: RuleCard): string {
  if (!card.print) {
    return card.card;
  }
  const [set, number] = card.print.split(' ');
  return `${card.card}@${printKey(set, number ?? '')}`;
}

/**
 * The first rule the deck satisfies, or null.
 * @param cards - The deck's cards
 * @param rules - Rules in priority order
 */
export function matchArchetypeRule(
  cards: readonly RuleDeckCard[],
  rules: readonly ArchetypeRule[]
): ArchetypeRule | null {
  const counts = tally(cards);
  return rules.find(rule => rule.requires.every(card => (counts.get(ruleKey(card)) ?? 0) >= card.copies)) ?? null;
}

/** Card thumbnails by archetype name, in the shape the archetype builder reads. */
export function ruleThumbnails(rules: readonly ArchetypeRule[]): Record<string, string[]> {
  return Object.fromEntries(rules.map(rule => [rule.name, rule.thumbnails]));
}

/** Sprite icons by archetype name. */
export function ruleIcons(rules: readonly ArchetypeRule[]): Record<string, string[]> {
  return Object.fromEntries(rules.map(rule => [rule.name, rule.icons]));
}
