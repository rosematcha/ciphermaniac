interface DeckRule {
  name?: string;
  id?: string;
  identifier?: string;
  cards?: unknown;
  descendants?: DeckRule[];
  children?: DeckRule[];
  variants?: DeckRule[];
  [key: string]: unknown;
}

interface Matcher {
  id: string | null;
  name: string;
  tokens: Set<string>;
  cardNames: Set<string>;
}

interface MatchScore {
  score: number;
  matchedCards: number;
  matchedTokens: number;
}

interface MatchScoreWithMatcher extends MatchScore {
  matcher: Matcher;
}

export interface DeckIndex {
  byId: Map<string, { id: string; name: string }>;
  matchers: Matcher[];
  ruleCount: number;
}

export interface ClassificationInput {
  deckName?: string;
  deckId?: string;
  decklist?: Record<string, Array<{ name?: string; [key: string]: unknown }>>;
}

export interface ClassificationResult {
  name: string;
  id: string | null;
  source: string;
  confidence?: number;
}

const GENERIC_ARCHETYPE_NAMES = new Set([
  '',
  'other',
  'other deck',
  'other decks',
  'rogue',
  'unknown',
  'unclassified',
  'uncategorized',
  'none',
  'n a',
  'na'
]);

const ARCHETYPE_STOPWORDS = new Set([
  'deck',
  'decks',
  'box',
  'control',
  'toolbox',
  'turbo',
  'goodstuff',
  'good',
  'stuff'
]);

const RULE_CONTAINER_KEYS = [
  'cards',
  'core',
  'coreCards',
  'required',
  'must',
  'include',
  'pokemon',
  'trainer',
  'energy'
];

function canonicalizeArchetypeLabel(value: unknown): string {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeForLookup(value: unknown): string {
  return canonicalizeArchetypeLabel(value)
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokenize(value: unknown): string[] {
  return normalizeForLookup(value).split(/\s+/).filter(Boolean);
}

function normalizeCardName(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/['’]/g, "'");
}

function isGenericArchetypeName(value: unknown): boolean {
  const normalized = normalizeForLookup(value);
  return !normalized || GENERIC_ARCHETYPE_NAMES.has(normalized);
}

function isLikelyDeckRule(value: unknown): value is DeckRule {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const hasName = typeof value.name === 'string' && value.name.trim().length > 0;
  const hasRuleShape =
    typeof value.id === 'string' ||
    Object.hasOwn(value, 'cards') ||
    Array.isArray(value.descendants) ||
    Array.isArray(value.children);
  return hasName && hasRuleShape;
}

function extractRuleItems(payload: any): any[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (!payload || typeof payload !== 'object') {
    return [];
  }
  if (Array.isArray(payload.decks)) {
    return payload.decks;
  }
  if (Array.isArray(payload.items)) {
    return payload.items;
  }
  return [];
}

function collectDeckRules(payload: any): DeckRule[] {
  const initial = extractRuleItems(payload);
  if (!initial.length) {
    return [];
  }

  const queue = [...initial];
  const rules = [];
  const seen = new Set();

  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== 'object') {
      continue;
    }

    const objectId = current;
    if (seen.has(objectId)) {
      continue;
    }
    seen.add(objectId);

    if (isLikelyDeckRule(current)) {
      rules.push(current);
    }

    const children = [];
    if (Array.isArray(current.descendants)) {
      children.push(...current.descendants);
    }
    if (Array.isArray(current.children)) {
      children.push(...current.children);
    }
    if (Array.isArray(current.variants)) {
      children.push(...current.variants);
    }

    children.forEach(child => {
      if (child && typeof child === 'object') {
        queue.push(child);
      }
    });
  }

  return rules;
}

function collectCardNames(value: any, names: Set<string>, depth = 0): void {
  if (depth > 5 || !value) {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach(entry => collectCardNames(entry, names, depth + 1));
    return;
  }

  if (typeof value === 'string') {
    const normalized = normalizeCardName(value);
    if (normalized) {
      names.add(normalized);
    }
    return;
  }

  if (typeof value !== 'object') {
    return;
  }

  if (typeof value.name === 'string' && value.name.trim()) {
    names.add(normalizeCardName(value.name));
  }

  Object.entries(value).forEach(([key, inner]) => {
    if (key === 'name') {
      return;
    }

    if (typeof inner === 'number' && /[a-z]/i.test(key) && !RULE_CONTAINER_KEYS.includes(key)) {
      names.add(normalizeCardName(key));
      return;
    }

    if (typeof inner === 'object' || Array.isArray(inner) || typeof inner === 'string') {
      collectCardNames(inner, names, depth + 1);
    }
  });
}

function collectRuleCardNames(rule: DeckRule): Set<string> {
  const names = new Set();
  if (!rule || typeof rule !== 'object') {
    return names;
  }

  RULE_CONTAINER_KEYS.forEach(key => {
    if (Object.hasOwn(rule, key)) {
      collectCardNames(rule[key], names);
    }
  });

  if (names.size === 0 && Object.hasOwn(rule, 'cards')) {
    collectCardNames(rule.cards, names);
  }

  return names;
}

function extractDecklistCardNames(decklist: any): Set<string> {
  const names = new Set();
  if (!decklist || typeof decklist !== 'object') {
    return names;
  }

  Object.values(decklist).forEach(section => {
    if (!Array.isArray(section)) {
      return;
    }
    section.forEach(card => {
      if (!card || typeof card !== 'object') {
        return;
      }
      const normalized = normalizeCardName(card.name);
      if (normalized) {
        names.add(normalized);
      }
    });
  });

  return names;
}

function buildDeckTokenSet(cardNames: Set<string>): Set<string> {
  const tokens = new Set();
  cardNames.forEach(name => {
    tokenize(name).forEach(token => tokens.add(token));
  });
  return tokens;
}

function scoreRuleMatch(deckCardNames: Set<string>, deckTokens: Set<string>, matcher: Matcher): MatchScore {
  let matchedCards = 0;
  matcher.cardNames.forEach(cardName => {
    if (deckCardNames.has(cardName)) {
      matchedCards += 1;
    }
  });

  let matchedTokens = 0;
  matcher.tokens.forEach(token => {
    if (deckTokens.has(token)) {
      matchedTokens += 1;
    }
  });

  const cardCoverage = matcher.cardNames.size ? matchedCards / matcher.cardNames.size : 0;
  const tokenCoverage = matcher.tokens.size ? matchedTokens / matcher.tokens.size : 0;
  const coverageBoost = Math.min(matchedCards, 5) * 0.03;
  const score = Math.max(cardCoverage, tokenCoverage * 0.9) + coverageBoost;

  return {
    score,
    matchedCards,
    matchedTokens
  };
}

function toMatcher(rule: DeckRule): Matcher | null {
  const name = canonicalizeArchetypeLabel(rule?.name);
  if (!name) {
    return null;
  }

  const tokens = new Set(tokenize(name).filter(token => !ARCHETYPE_STOPWORDS.has(token)));
  const cardNames = collectRuleCardNames(rule);
  if (!tokens.size && !cardNames.size) {
    return null;
  }

  const id = String(rule?.identifier || rule?.id || '').trim() || null;
  return {
    id,
    name,
    tokens,
    cardNames
  };
}

function buildArchetypeDeckIndex(payload: any): DeckIndex {
  const rules = collectDeckRules(payload);
  const byId = new Map<string, { id: string; name: string }>();
  const matchers: Matcher[] = [];

  rules.forEach(rule => {
    const name = canonicalizeArchetypeLabel(rule?.name);
    const id = String(rule?.identifier || rule?.id || '').trim();

    if (id && name && !byId.has(id.toLowerCase())) {
      byId.set(id.toLowerCase(), { id, name });
    }

    const matcher = toMatcher(rule);
    if (matcher) {
      matchers.push(matcher);
    }
  });

  return {
    byId,
    matchers,
    ruleCount: rules.length
  };
}

function resolveArchetypeClassification(input: ClassificationInput, deckIndex: DeckIndex | null): ClassificationResult {
  const deckName = canonicalizeArchetypeLabel(input?.deckName);
  const deckId = String(input?.deckId || '').trim();
  const idMatch = deckId && deckIndex?.byId ? deckIndex.byId.get(deckId.toLowerCase()) : null;

  if (deckName && !isGenericArchetypeName(deckName)) {
    return {
      name: deckName,
      id: deckId || idMatch?.id || null,
      source: 'api-name'
    };
  }

  if (idMatch?.name) {
    return {
      name: idMatch.name,
      id: idMatch.id || deckId || null,
      source: 'deck-id'
    };
  }

  const deckCardNames = extractDecklistCardNames(input?.decklist);
  if (deckCardNames.size && Array.isArray(deckIndex?.matchers) && deckIndex.matchers.length) {
    const deckTokens = buildDeckTokenSet(deckCardNames);
    let best: MatchScoreWithMatcher | null = null;
    let secondBest: MatchScore | null = null;

    deckIndex.matchers.forEach(matcher => {
      const score = scoreRuleMatch(deckCardNames, deckTokens, matcher);
      if (!best || score.score > best.score) {
        secondBest = best;
        best = {
          ...score,
          matcher
        };
      } else if (!secondBest || score.score > secondBest.score) {
        secondBest = score;
      }
    });

    const bestScore = best?.score || 0;
    const secondScore = secondBest?.score || 0;
    const margin = bestScore - secondScore;
    const hasStrongTokenMatch = (best?.matchedTokens || 0) >= 2;
    const hasStrongCardMatch = (best?.matchedCards || 0) >= 1;

    if (best && bestScore >= 0.62 && margin >= 0.08 && (hasStrongTokenMatch || hasStrongCardMatch)) {
      return {
        name: best.matcher.name,
        id: best.matcher.id || deckId || null,
        source: 'decklist-match',
        confidence: Math.round(bestScore * 1000) / 1000
      };
    }
  }

  if (deckName) {
    return {
      name: deckName,
      id: deckId || null,
      source: 'fallback'
    };
  }

  return {
    name: 'Unknown',
    id: deckId || null,
    source: 'unknown'
  };
}

export { buildArchetypeDeckIndex, resolveArchetypeClassification };
