/**
 * Limitless's deck rules (`GET /games/PTCG/decks`), applied to a decklist the
 * way Limitless Play applies them. Limitless names Play decks itself; this is
 * for decks it leaves unnamed (City Leagues), so they share Standard's names.
 *
 * Matching, reproduced against every labelled Standard deck in a 14-day
 * window: rules are tried by ascending `priority`, a tie going to the rule
 * that asks for more copies in total, then to list order. A rule matches when
 * each card it names appears in at least `count` copies on one line of the
 * list (copies split across prints don't add up). The first match wins; its
 * first matching variant, if any, names the deck instead.
 * @module shared/formats/deckRules
 */

/** One card a rule asks for, as Limitless sends it. */
interface DeckRuleCard {
  name: string;
  /** Minimum copies. Limitless sends a string, and omits it for 1. */
  count?: string | number | null;
  set?: string | null;
  number?: string | null;
}

interface DeckRuleVariant {
  identifier: string;
  name: string;
  /** The sprite added after the parent rule's first one. */
  icon?: string | null;
  cards: DeckRuleCard[];
}

export interface DeckRule {
  identifier: string | null;
  name: string | null;
  icons?: string[] | null;
  priority?: number | null;
  cards?: DeckRuleCard[] | null;
  variants?: DeckRuleVariant[] | null;
  /** The era a rule belongs to; the newest one is current Standard. */
  generation?: number | null;
}

/** What a matching rule names a deck. */
export interface DeckRuleMatch {
  id: string;
  name: string;
  icons: string[];
}

interface CompiledRule {
  match: DeckRuleMatch;
  cards: DeckRuleCard[];
  variants: { match: DeckRuleMatch; cards: DeckRuleCard[] }[];
}

/** The fields of a deck's card the rules read. */
interface RuleDeckCard {
  name: string;
  set: string | null;
  number: string | null;
  count: number;
}

const DEFAULT_PRIORITY = 10;

function copiesOf(card: DeckRuleCard): number {
  return Number(card.count) || 1;
}

function totalCopies(rule: DeckRule): number {
  return (rule.cards ?? []).reduce((sum, card) => sum + copiesOf(card), 0);
}

function isUsable(rule: DeckRule): rule is DeckRule & { identifier: string; name: string } {
  return Boolean(rule.identifier && rule.name && rule.cards?.length);
}

function compile(rule: DeckRule & { identifier: string; name: string }): CompiledRule {
  const icons = rule.icons ?? [];
  return {
    match: { id: rule.identifier, name: rule.name, icons },
    cards: rule.cards ?? [],
    variants: (rule.variants ?? []).map(variant => ({
      match: {
        id: variant.identifier,
        name: variant.name,
        icons: [...icons.slice(0, 1), ...(variant.icon ? [variant.icon] : [])]
      },
      cards: variant.cards
    }))
  };
}

/** The newest generation among the rules, or null when none carries one. */
function newestGeneration(rules: readonly DeckRule[]): number | null {
  const generations = rules.map(rule => rule.generation).filter((value): value is number => typeof value === 'number');
  return generations.length ? Math.max(...generations) : null;
}

export type CompiledDeckRules = readonly CompiledRule[];

/**
 * The current era's rules in the order they are tried.
 * @param limitless - Limitless's rules, every generation
 * @param extra - Rules of our own, in Limitless's shape, ordered among Limitless's by the same priority
 */
export function compileDeckRules(limitless: readonly DeckRule[], extra: readonly DeckRule[] = []): CompiledDeckRules {
  const generation = newestGeneration(limitless);
  const current = limitless.filter(rule => generation === null || rule.generation === generation);
  return [...extra, ...current]
    .filter(isUsable)
    .map((rule, order) => ({ rule, order }))
    .sort(
      (a, b) =>
        (a.rule.priority ?? DEFAULT_PRIORITY) - (b.rule.priority ?? DEFAULT_PRIORITY) ||
        totalCopies(b.rule) - totalCopies(a.rule) ||
        a.order - b.order
    )
    .map(({ rule }) => compile(rule));
}

/** Most copies on any one line of the list that is this card. */
function copiesOnOneLine(want: DeckRuleCard, cards: readonly RuleDeckCard[]): number {
  let best = 0;
  for (const card of cards) {
    const same =
      card.name === want.name && (!want.set || card.set === want.set) && (!want.number || card.number === want.number);
    if (same && card.count > best) {
      best = card.count;
    }
  }
  return best;
}

function satisfies(wants: readonly DeckRuleCard[], cards: readonly RuleDeckCard[]): boolean {
  return wants.every(want => copiesOnOneLine(want, cards) >= copiesOf(want));
}

/**
 * What the rules name the deck, or null when none matches.
 * @param cards - The deck's cards
 * @param rules - From {@link compileDeckRules}
 */
export function matchDeckRules(cards: readonly RuleDeckCard[], rules: CompiledDeckRules): DeckRuleMatch | null {
  const rule = rules.find(candidate => satisfies(candidate.cards, cards));
  if (!rule) {
    return null;
  }
  return rule.variants.find(variant => satisfies(variant.cards, cards))?.match ?? rule.match;
}

/** Sprite icons by archetype name, the first rule giving a name keeping it. */
export function deckRuleIcons(rules: CompiledDeckRules): Record<string, string[]> {
  const icons: Record<string, string[]> = {};
  for (const { match, variants } of rules) {
    for (const named of [match, ...variants.map(variant => variant.match)]) {
      if (named.icons.length && !icons[named.name]) {
        icons[named.name] = named.icons;
      }
    }
  }
  return icons;
}
