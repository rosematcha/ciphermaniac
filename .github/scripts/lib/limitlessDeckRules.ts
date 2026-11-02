/**
 * Play! Limitless's deck categorization rules, published to R2 for the events
 * site, which names a pasted list by them without holding a Limitless key.
 *
 * Limitless documents the rules at docs.limitlesstcg.com/developer/games: a
 * list is a deck when it holds every listed card at least `count` times (by
 * exact name, and by set or number where the rule gives one), rules are tried
 * from the lowest `priority` up, and a deck's variants are tried once it
 * matches. The API is looser than its docs (counts come as strings or not at
 * all, a variant names its icon `icon`), so the copy published here is read
 * into one shape, keeping the order Limitless sends.
 */

/** Where the rules live in the reports bucket. */
export const DECK_RULES_KEY = 'limitless/deck-rules.json';

/** Fewer rules than this is a failed or partial answer, and yesterday's copy stays. */
const MIN_RULES = 100;

export interface DeckRuleCard {
  name: string;
  /** The fewest copies a list must hold; 1 where Limitless gives none. */
  count: number;
  set?: string;
  number?: string;
}

export interface DeckVariant {
  identifier: string;
  name: string;
  icons: string[];
  cards: DeckRuleCard[];
}

export interface DeckRule extends DeckVariant {
  /** Lower first; Limitless's default is 10. */
  priority: number;
  /** The era the deck belongs to, when Limitless gives one. */
  generation: number | null;
  variants: DeckVariant[];
}

/** The published file. It carries no date, so a day Limitless changed nothing writes nothing. */
export interface PublishedDeckRules {
  rules: DeckRule[];
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

function readCard(value: unknown): DeckRuleCard[] {
  const raw = (value ?? {}) as Record<string, unknown>;
  const name = text(raw.name);
  const count = raw.count === undefined || raw.count === null || raw.count === '' ? 1 : Number(raw.count);
  if (!name || !Number.isInteger(count) || count < 1) {
    return [];
  }
  const set = text(raw.set);
  const number = text(raw.number);
  return [{ name, count, ...(set ? { set } : {}), ...(number ? { number } : {}) }];
}

function readIcons(raw: Record<string, unknown>): string[] {
  const icons = Array.isArray(raw.icons) ? raw.icons : [raw.icon];
  return icons.map(text).filter(Boolean);
}

function readVariant(value: unknown): DeckVariant | null {
  const raw = (value ?? {}) as Record<string, unknown>;
  const identifier = text(raw.identifier);
  const name = text(raw.name);
  const cards = Array.isArray(raw.cards) ? raw.cards.flatMap(readCard) : [];
  // A rule with no cards would name every list.
  return identifier && name && cards.length ? { identifier, name, icons: readIcons(raw), cards } : null;
}

function readRule(value: unknown): DeckRule[] {
  const variant = readVariant(value);
  if (!variant) {
    return [];
  }
  const raw = value as Record<string, unknown>;
  const priority = typeof raw.priority === 'number' && Number.isFinite(raw.priority) ? raw.priority : 10;
  const generation = typeof raw.generation === 'number' ? raw.generation : null;
  const variants = Array.isArray(raw.variants) ? raw.variants.map(readVariant).filter(v => v !== null) : [];
  return [{ ...variant, priority, generation, variants }];
}

/** Limitless's answer read into the published shape; anything that does not read as a rule is left out. */
export function readDeckRules(payload: unknown): DeckRule[] {
  return Array.isArray(payload) ? payload.flatMap(readRule) : [];
}

export interface DeckRulesRun {
  fetchJson: (path: string) => Promise<unknown>;
  write: (key: string, value: PublishedDeckRules) => Promise<void>;
  log?: (line: string) => void;
}

/** Fetches the rules and publishes them; a short answer is logged and the copy already published stays. */
export async function publishDeckRules(run: DeckRulesRun): Promise<boolean> {
  const rules = readDeckRules(await run.fetchJson('/games/PTCG/decks'));
  if (rules.length < MIN_RULES) {
    run.log?.(`[deck-rules] Limitless sent ${rules.length} rules; keeping the published copy`);
    return false;
  }
  await run.write(DECK_RULES_KEY, { rules });
  run.log?.(`[deck-rules] Published ${rules.length} rules`);
  return true;
}
