import { jsonError } from '../../lib/responses.js';
import { filterDecksBySuccess, generateReportForFilters } from '../../../src/utils/clientSideFiltering.js';
import type { ArchetypeFilterRequest, Filter } from '../../../src/types/index.js';

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*'
} as const;

const RESPONSE_CACHE_CONTROL = 'public, max-age=60, s-maxage=180';

interface RequestContext {
  request: Request;
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

function normalizeFilter(raw: unknown): Filter | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const cardId = normalizeString(record.cardId);
  if (!cardId) {
    return null;
  }
  const operator = normalizeString(record.operator || null) || null;
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

  const filters = Array.isArray(record.filters)
    ? record.filters.map(normalizeFilter).filter((entry): entry is Filter => Boolean(entry))
    : [];

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
  const archetypeSpecific = await fetchDecksFromPath(request, buildReportsPath(payload, true));
  if (Array.isArray(archetypeSpecific)) {
    return archetypeSpecific;
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

function buildJsonResponse(body: unknown, status = 200, cacheControl = RESPONSE_CACHE_CONTROL): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...JSON_HEADERS,
      'Cache-Control': cacheControl
    }
  });
}

export async function onRequestPost({ request }: RequestContext): Promise<Response> {
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

  const successScopedDecks = filterDecksBySuccess(decks, payload.successFilter);
  const report = generateReportForFilters(successScopedDecks, payload.archetype, payload.filters || []);
  const response = buildJsonResponse({
    deckTotal: report.deckTotal,
    items: report.items,
    raw: {
      generatedServerSide: true,
      filters: (payload.filters || []).length,
      successFilter: payload.successFilter,
      generatedAt: new Date().toISOString()
    }
  });

  if (cacheRequest) {
    await caches.default.put(cacheRequest, response.clone());
  }

  return response;
}

export function onRequestOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
