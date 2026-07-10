import { corsPreflight, jsonError, jsonResponse } from '../../lib/api/responses.js';
import {
  filterDecksBySuccess,
  generateReportForFilters,
  QUANTITY_OPERATORS,
  SUCCESS_TAG_HIERARCHY
} from '../../../src/utils/clientSideFiltering.js';
import { canonicalizeDeckCard } from '../../../src/utils/deckCardId.js';
import { loadCardSynonyms } from '../../lib/data/cardSynonyms.js';
import type { ArchetypeFilterRequest, Filter } from '../../../src/types/index.js';

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*'
} as const;

const RESPONSE_CACHE_CONTROL = 'public, max-age=60, s-maxage=180';

// Cap the number of filters per request — each filter costs a pass over the
// deck list, so an unbounded array is an easy CPU-exhaustion vector.
const MAX_FILTERS = 50;

// Allowlisted success brackets: the canonical tag hierarchy plus "all". An
// unknown value used to pass through and silently return every deck; now it
// 400s.
const VALID_SUCCESS_FILTERS = new Set(['all', ...SUCCESS_TAG_HIERARCHY]);

// Allowlisted quantity operators. Empty / absent means "none" (exclude, count
// must be 0). Any other non-empty string is rejected so a typo can't broaden
// results.
const VALID_OPERATORS = new Set(QUANTITY_OPERATORS);

/** Sentinel: a filter carried an unknown operator → reject the whole payload. */
const INVALID_FILTER = Symbol('invalid-filter');

interface RequestContext {
  request: Request;
  env?: Parameters<typeof loadCardSynonyms>[0];
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeSlice(value: unknown): 'all' | 'phase2' | 'topcut' {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === 'phase2' || normalized === 'topcut') {
    return normalized;
  }
  return 'all';
}

function normalizeFilter(raw: unknown): Filter | null | typeof INVALID_FILTER {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const cardId = normalizeString(record.cardId);
  if (!cardId) {
    return null;
  }
  const rawOperator = normalizeString(record.operator);
  if (rawOperator && !VALID_OPERATORS.has(rawOperator)) {
    return INVALID_FILTER;
  }
  const operator = rawOperator || null;
  const numericCount = Number(record.count);
  const count = Number.isFinite(numericCount) ? numericCount : null;
  return {
    cardId,
    operator: operator as Filter['operator'],
    count
  };
}

function normalizePayload(raw: unknown): ArchetypeFilterRequest | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const tournament = normalizeString(record.tournament);
  const archetype = normalizeString(record.archetype);
  const successFilter = normalizeString(record.successFilter || 'all') || 'all';

  if (!tournament || !archetype) {
    return null;
  }

  if (!VALID_SUCCESS_FILTERS.has(successFilter)) {
    return null;
  }

  if (Array.isArray(record.filters) && record.filters.length > MAX_FILTERS) {
    return null;
  }

  const filters: Filter[] = [];
  if (Array.isArray(record.filters)) {
    for (const raw of record.filters) {
      const normalized = normalizeFilter(raw);
      if (normalized === INVALID_FILTER) {
        // An unknown operator is a client error, not something to silently drop.
        return null;
      }
      if (normalized) {
        filters.push(normalized);
      }
    }
  }

  return {
    tournament,
    archetype,
    successFilter,
    filters,
    slice: normalizeSlice(record.slice)
  };
}

function buildReportsPath(payload: ArchetypeFilterRequest, archetypeDecks = false): string {
  const encodedTournament = encodeURIComponent(payload.tournament);
  const slicePath = payload.slice && payload.slice !== 'all' ? `/slices/${payload.slice}` : '';
  if (archetypeDecks) {
    return `/reports/${encodedTournament}${slicePath}/archetypes/${encodeURIComponent(payload.archetype)}/decks.json`;
  }
  return `/reports/${encodedTournament}${slicePath}/decks.json`;
}

async function fetchDecksFromPath(request: Request, path: string): Promise<any[] | null> {
  const targetUrl = new URL(path, request.url);
  const response = await fetch(targetUrl.toString(), {
    method: 'GET'
  });
  if (!response.ok) {
    return null;
  }

  const payload = await response.json().catch(() => null);
  return Array.isArray(payload) ? payload : null;
}

async function loadDecks(request: Request, payload: ArchetypeFilterRequest): Promise<any[] | null> {
  // Try the small archetype-specific slice first; only fall back to the full
  // (multi-MB) decks file when the slice is missing. Fetching both in parallel
  // wasted bandwidth/CPU downloading the large file on every request.
  const specific = await fetchDecksFromPath(request, buildReportsPath(payload, true));
  if (Array.isArray(specific)) {
    return specific;
  }
  return fetchDecksFromPath(request, buildReportsPath(payload, false));
}

function buildCachePayload(payload: ArchetypeFilterRequest): string {
  const normalizedFilters = [...(payload.filters || [])]
    .map(filter => ({
      cardId: String(filter.cardId || '')
        .trim()
        .toUpperCase(),
      operator: filter.operator || null,
      count: Number.isFinite(Number(filter.count)) ? Number(filter.count) : null
    }))
    .sort((left, right) => left.cardId.localeCompare(right.cardId));
  return JSON.stringify({
    tournament: payload.tournament,
    archetype: payload.archetype,
    successFilter: payload.successFilter,
    slice: payload.slice || 'all',
    filters: normalizedFilters
  });
}

async function hashKey(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .slice(0, 16)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function buildCacheRequest(request: Request, payload: ArchetypeFilterRequest): Promise<Request | null> {
  if (typeof caches === 'undefined' || !caches.default) {
    return null;
  }
  const cacheKeyHash = await hashKey(buildCachePayload(payload));
  const url = new URL(request.url);
  url.search = `cacheKey=${cacheKeyHash}`;
  return new Request(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' }
  });
}

/**
 * Rewrite every deck card to its canonical printing so aggregation counts
 * synonym-unified variants as one card. Without this, the API path splits a
 * card's playrate across printings while the client panel (which canonicalizes
 * before aggregating) merges them.
 */
function canonicalizeDecks(decks: any[], db: Awaited<ReturnType<typeof loadCardSynonyms>>): any[] {
  return decks.map(deck => {
    if (!deck || !Array.isArray(deck.cards)) {
      return deck;
    }
    return { ...deck, cards: deck.cards.map((card: any) => canonicalizeDeckCard(card, db)) };
  });
}

export async function onRequestPost({ request, env }: RequestContext): Promise<Response> {
  const rawBody = await request.json().catch(() => null);
  const payload = normalizePayload(rawBody);
  if (!payload) {
    return jsonError('Invalid archetype filter payload', 400, {
      ...JSON_HEADERS
    });
  }

  const cacheRequest = await buildCacheRequest(request, payload);
  if (cacheRequest) {
    const cached = await caches.default.match(cacheRequest);
    if (cached) {
      return cached;
    }
  }

  const decks = await loadDecks(request, payload);
  if (!decks) {
    return jsonError('Deck data not available for requested tournament', 404, {
      ...JSON_HEADERS
    });
  }

  // loadCardSynonyms degrades to an empty DB on failure, in which case
  // canonicalizeDeckCard is a no-op — same behavior as before this existed.
  const synonymDb = env ? await loadCardSynonyms(env) : { synonyms: {}, canonicals: {}, metadata: {} };
  const canonicalDecks = canonicalizeDecks(decks, synonymDb as Awaited<ReturnType<typeof loadCardSynonyms>>);

  const successScopedDecks = filterDecksBySuccess(canonicalDecks, payload.successFilter);
  const report = generateReportForFilters(successScopedDecks, payload.archetype, payload.filters || []);
  const response = jsonResponse(
    {
      deckTotal: report.deckTotal,
      items: report.items,
      raw: {
        generatedServerSide: true,
        filters: (payload.filters || []).length,
        successFilter: payload.successFilter,
        generatedAt: new Date().toISOString()
      }
    },
    { cacheControl: RESPONSE_CACHE_CONTROL }
  );

  if (cacheRequest) {
    await caches.default.put(cacheRequest, response.clone());
  }

  return response;
}

export function onRequestOptions(): Response {
  return corsPreflight('POST, OPTIONS');
}
