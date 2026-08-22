/**
 * POST /api/archetype/filter-report — server-side archetype filter aggregation.
 *
 * The request body is untrusted input that selects an R2 object path and then
 * drives a pass over multi-megabyte deck data, so it is decoded strictly before
 * anything expensive happens: bounded body size, bounded string lengths, an
 * allowlisted success bracket / slice / operator, integer copy counts in range,
 * and a capped filter count.
 *
 * Decoding also CANONICALIZES the filter set — sorted by a total order and
 * deduplicated — so two spellings of one logical request share a cache entry
 * instead of each paying for a full aggregation.
 */

import { corsPreflight, jsonError, jsonResponse } from '../../lib/api/responses.js';
import {
  filterDecks,
  filterDecksBySuccess,
  generateReportForFilters,
  normalizeCardMatchId,
  QUANTITY_OPERATORS,
  SUCCESS_TAG_HIERARCHY
} from '../../../shared/clientSideFiltering.js';
import { canonicalizeDeckCard } from '../../../shared/deckCardId.js';
import { loadCardSynonyms } from '../../../shared/data/cardSynonyms.js';
import type { ArchetypeFilterRequest, Deck, Filter, Operator } from '../../../shared/deckTypes.js';

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*'
} as const;

const RESPONSE_CACHE_CONTROL = 'public, max-age=60, s-maxage=180';

// Cap the number of filters per request — each filter costs a pass over the
// deck list, so an unbounded array is an easy CPU-exhaustion vector.
const MAX_FILTERS = 50;

// Hard byte ceiling on the request body, independent of MAX_FILTERS: the filter
// cap is only enforced AFTER JSON.parse, so without this a single multi-megabyte
// body still costs a full parse. 50 filters of realistic size is a few KB.
const MAX_BODY_BYTES = 16 * 1024;

// Tournament and archetype select an R2 object path. encodeURIComponent already
// prevents traversal; this bounds the URL a malicious caller can make us build.
const MAX_NAME_LENGTH = 200;
const MAX_CARD_ID_LENGTH = 64;

// A deck holds 60 cards, so no honest copy-count filter exceeds that.
const MAX_FILTER_COUNT = 60;

// Allowlisted success brackets: the canonical tag hierarchy plus "all". An
// unknown value used to pass through and silently return every deck; now it
// 400s.
const VALID_SUCCESS_FILTERS = new Set(['all', ...SUCCESS_TAG_HIERARCHY]);

// Allowlisted quantity operators. Empty / absent means "none" (exclude, count
// must be 0). Any other non-empty string is rejected so a typo can't broaden
// results.
const VALID_OPERATORS = new Set(QUANTITY_OPERATORS);

const VALID_SLICES = new Set(['all', 'phase2', 'topcut']);

interface RequestContext {
  request: Request;
  env?: Parameters<typeof loadCardSynonyms>[0];
  /** Optional in tests, which invoke the handler with a bare `{ request }`. */
  waitUntil?: (promise: Promise<unknown>) => void;
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * True when a field is present but not a string.
 *
 * {@link normalizeString} collapses a non-string to `''`, which is
 * indistinguishable from absent — so `successFilter: true` would silently
 * become `'all'` rather than being rejected, defeating the point of an
 * allowlist.
 */
function isPresentNonString(value: unknown): boolean {
  return value !== undefined && value !== null && typeof value !== 'string';
}

/**
 * Read the body with a hard byte ceiling.
 *
 * Checks Content-Length first (cheap rejection for an honest client) and then
 * measures the decoded text, because a chunked body can omit the header
 * entirely.
 * @returns The parsed JSON, or a symbol describing why it was rejected
 */
const BODY_TOO_LARGE = Symbol('body-too-large');
const BODY_UNPARSEABLE = Symbol('body-unparseable');

/**
 * Read a request body to text, aborting once it exceeds `maxBytes`.
 *
 * Counts the bytes of each chunk as it arrives rather than buffering the whole
 * body and measuring afterwards, so an unbounded body costs at most one chunk
 * past the cap.
 * @param request - The incoming request
 * @param maxBytes - Ceiling, in UTF-8 bytes
 * @returns The decoded text
 * @throws {typeof BODY_TOO_LARGE} Once the running byte count exceeds the cap
 */
async function readBoundedText(request: Request, maxBytes: number): Promise<string> {
  const { body } = request;
  if (!body) {
    // No stream (some runtimes, and tests constructing a Request from a string)
    // — fall back to buffering, still measuring bytes rather than characters.
    const text = await request.text();
    if (new TextEncoder().encode(text).length > maxBytes) {
      throw BODY_TOO_LARGE;
    }
    return text;
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let seen = 0;
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    seen += value.byteLength;
    if (seen > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw BODY_TOO_LARGE;
    }
    out += decoder.decode(value, { stream: true });
  }
  return out + decoder.decode();
}

async function readBody(request: Request): Promise<unknown | typeof BODY_TOO_LARGE | typeof BODY_UNPARSEABLE> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return BODY_TOO_LARGE;
  }
  // Read the body as a stream, counting BYTES and bailing the moment the count
  // exceeds the cap. Two reasons not to buffer first: `text.length` counts
  // UTF-16 code units, which UNDER-count UTF-8 by up to 3x for non-Latin
  // scripts (so an oversized multi-byte body would slip through), and
  // `request.text()` on a chunked body with no honest Content-Length buffers
  // without bound before any check can reject it.
  let text: string;
  try {
    text = await readBoundedText(request, MAX_BODY_BYTES);
  } catch (err) {
    return err === BODY_TOO_LARGE ? BODY_TOO_LARGE : BODY_UNPARSEABLE;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return BODY_UNPARSEABLE;
  }
}

/** Sentinel: a field was present but invalid → reject the whole payload. */
const INVALID = Symbol('invalid');

function normalizeSlice(value: unknown): ArchetypeFilterRequest['slice'] | typeof INVALID {
  if (value === undefined || value === null || value === '') {
    return 'all';
  }
  const normalized = normalizeString(value).toLowerCase();
  // An unrecognized slice used to silently fall back to 'all', so a typo
  // returned the unsliced report as if it were the requested one.
  return VALID_SLICES.has(normalized) ? (normalized as ArchetypeFilterRequest['slice']) : INVALID;
}

function normalizeFilter(raw: unknown): Filter | null | typeof INVALID {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (isPresentNonString(record.cardId)) {
    return INVALID;
  }
  const rawCardId = normalizeString(record.cardId);
  if (!rawCardId) {
    return null;
  }
  if (rawCardId.length > MAX_CARD_ID_LENGTH) {
    return INVALID;
  }
  // Normalize to the exact form deck counts are keyed by. Matching is an exact
  // Map lookup, so `svi~191` or `SVI~1` would match ZERO decks silently — and
  // because the cache key normalized case but the matcher did not, the wrong
  // answer was cached under the right request's key.
  const cardId = normalizeCardMatchId(rawCardId);
  if (!cardId) {
    return INVALID;
  }
  if (isPresentNonString(record.operator)) {
    return INVALID;
  }
  const rawOperator = normalizeString(record.operator);
  if (rawOperator && !VALID_OPERATORS.has(rawOperator)) {
    return INVALID;
  }
  const operator = (rawOperator || null) as Operator | null;

  let count: number | null = null;
  if (record.count !== undefined && record.count !== null && record.count !== '') {
    // Only a number or a numeric string. `Number(true)` is 1 and `Number([])`
    // is 0, so coercing anything would let a boolean silently mean "one copy".
    if (typeof record.count !== 'number' && typeof record.count !== 'string') {
      return INVALID;
    }
    const numeric = Number(record.count);
    // Copy counts are whole cards in a bounded range. Coercing 1e9 or -1 or 2.5
    // into a comparator produces a filter no deck can satisfy while still
    // costing a full pass.
    if (!Number.isInteger(numeric) || numeric < 0 || numeric > MAX_FILTER_COUNT) {
      return INVALID;
    }
    count = numeric;
  }

  return { cardId, operator, count };
}

/**
 * Total order over filters, so a canonical filter list is a pure function of
 * the filter SET rather than of the order the client happened to send.
 *
 * Sorting by cardId alone left ties in input order, which gave one logical
 * request two cache keys. Plain string comparison rather than `localeCompare`
 * so the ordering is not locale-dependent.
 */
/**
 * Whether a filter's `count` changes which decks match.
 *
 * `any` means "one or more" and the empty operator means "none"; both ignore
 * the count (shared/clientSideFiltering matchesQuantity). Ordering, dedupe and
 * the cache key all have to agree on that, or two spellings of one request
 * diverge.
 */
function countAffectsMatching(operator: Operator | null | undefined): boolean {
  return Boolean(operator) && operator !== 'any';
}

function compareFilters(a: Filter, b: Filter): number {
  if (a.cardId !== b.cardId) {
    return a.cardId < b.cardId ? -1 : 1;
  }
  const aOp = a.operator ?? '';
  const bOp = b.operator ?? '';
  if (aOp !== bOp) {
    return aOp < bOp ? -1 : 1;
  }
  const aCount = countAffectsMatching(a.operator) ? (a.count ?? -1) : -1;
  const bCount = countAffectsMatching(b.operator) ? (b.count ?? -1) : -1;
  return aCount - bCount;
}

/**
 * Sort and deduplicate a filter list.
 *
 * Filters combine as a conjunction, so an exact duplicate is a no-op on the
 * result but still costs a per-deck comparison and perturbs the cache key.
 * Contradictory filters on one card (`=2` and `=3`) are left alone: they
 * legitimately mean "no deck matches".
 */
function canonicalizeFilters(filters: Filter[]): Filter[] {
  const sorted = [...filters].sort(compareFilters);
  const out: Filter[] = [];
  for (const filter of sorted) {
    const previous = out[out.length - 1];
    if (previous && compareFilters(previous, filter) === 0) {
      continue;
    }
    out.push(filter);
  }
  return out;
}

function normalizePayload(raw: unknown): ArchetypeFilterRequest | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (
    isPresentNonString(record.tournament) ||
    isPresentNonString(record.archetype) ||
    isPresentNonString(record.successFilter) ||
    isPresentNonString(record.slice)
  ) {
    return null;
  }
  const tournament = normalizeString(record.tournament);
  const archetype = normalizeString(record.archetype);
  const successFilter = normalizeString(record.successFilter || 'all') || 'all';

  if (!tournament || !archetype) {
    return null;
  }
  if (tournament.length > MAX_NAME_LENGTH || archetype.length > MAX_NAME_LENGTH) {
    return null;
  }

  if (!VALID_SUCCESS_FILTERS.has(successFilter)) {
    return null;
  }

  const slice = normalizeSlice(record.slice);
  if (slice === INVALID) {
    return null;
  }

  if (record.filters !== undefined && record.filters !== null && !Array.isArray(record.filters)) {
    return null;
  }
  if (Array.isArray(record.filters) && record.filters.length > MAX_FILTERS) {
    return null;
  }

  const filters: Filter[] = [];
  if (Array.isArray(record.filters)) {
    for (const entry of record.filters) {
      const normalized = normalizeFilter(entry);
      if (normalized === INVALID) {
        // An unknown operator or out-of-range count is a client error, not
        // something to silently drop.
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
    filters: canonicalizeFilters(filters),
    slice
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

/**
 * Why a deck fetch produced no decks. "The tournament has no such artifact" and
 * "our storage returned a 500" are different facts about the system, and
 * collapsing both into 404 hides an outage behind a routine client error.
 */
type DeckFetch =
  | { status: 'ok'; decks: Deck[] }
  | { status: 'missing' }
  | { status: 'malformed'; detail: string }
  | { status: 'upstream'; httpStatus: number }
  | { status: 'transport'; detail: string };

async function fetchDecksFromPath(request: Request, path: string): Promise<DeckFetch> {
  const targetUrl = new URL(path, request.url);
  let response: Response;
  try {
    response = await fetch(targetUrl.toString(), { method: 'GET' });
  } catch (err) {
    return { status: 'transport', detail: err instanceof Error ? err.message : String(err) };
  }
  if (response.status === 404 || response.status === 410) {
    return { status: 'missing' };
  }
  if (!response.ok) {
    return { status: 'upstream', httpStatus: response.status };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (err) {
    return { status: 'malformed', detail: err instanceof Error ? err.message : String(err) };
  }
  if (!Array.isArray(payload)) {
    return { status: 'malformed', detail: `expected an array, got ${typeof payload}` };
  }
  return { status: 'ok', decks: payload as Deck[] };
}

async function loadDecks(request: Request, payload: ArchetypeFilterRequest): Promise<DeckFetch> {
  // Try the small archetype-specific slice first; only fall back to the full
  // (multi-MB) decks file when the slice is missing. Fetching both in parallel
  // wasted bandwidth/CPU downloading the large file on every request.
  const specific = await fetchDecksFromPath(request, buildReportsPath(payload, true));
  if (specific.status === 'ok') {
    return specific;
  }
  const fallback = await fetchDecksFromPath(request, buildReportsPath(payload, false));
  // A genuinely absent per-archetype slice is normal; report the fallback's
  // outcome. But if the slice fetch failed for an interesting reason and the
  // fallback is merely missing, surface the interesting one.
  if (fallback.status === 'missing' && specific.status !== 'missing') {
    return specific;
  }
  return fallback;
}

/** Map a failed deck load to a client response, logging the actionable detail. */
function deckFetchError(result: Exclude<DeckFetch, { status: 'ok' }>, payload: ArchetypeFilterRequest): Response {
  const where = `${payload.tournament}/${payload.archetype} (slice=${payload.slice})`;
  switch (result.status) {
    case 'missing':
      return jsonError('Deck data not available for requested tournament', 404, { ...JSON_HEADERS });
    case 'malformed':
      console.error(`filter-report: malformed deck artifact for ${where}: ${result.detail}`);
      return jsonError('Deck data is unreadable', 502, { ...JSON_HEADERS });
    case 'upstream':
      console.error(`filter-report: deck storage returned ${result.httpStatus} for ${where}`);
      return jsonError('Deck data is temporarily unavailable', 502, { ...JSON_HEADERS });
    default:
      console.error(`filter-report: deck fetch failed for ${where}: ${result.detail}`);
      return jsonError('Deck data is temporarily unavailable', 502, { ...JSON_HEADERS });
  }
}

function buildCachePayload(payload: ArchetypeFilterRequest): string {
  // payload.filters is already canonical (sorted + deduped) from decoding, so
  // the key is a function of the request's MEANING. cardId is uppercased here
  // because deck card ids are case-insensitive on the wire.
  return JSON.stringify({
    tournament: payload.tournament,
    archetype: payload.archetype,
    successFilter: payload.successFilter,
    slice: payload.slice || 'all',
    filters: payload.filters.map(filter => ({
      cardId: filter.cardId,
      operator: filter.operator || null,
      // `any` and the exclude operator ignore the count entirely (see
      // matchesQuantity), so keeping it in the key would split one logical
      // request across cache entries that can only ever hold the same answer.
      count: countAffectsMatching(filter.operator) ? (filter.count ?? null) : null
    }))
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
function canonicalizeDecks(decks: Deck[], db: Awaited<ReturnType<typeof loadCardSynonyms>>): Deck[] {
  return decks.map(deck => {
    if (!deck || !Array.isArray(deck.cards)) {
      return deck;
    }
    return { ...deck, cards: deck.cards.map(card => canonicalizeDeckCard(card, db)) };
  });
}

export async function onRequestPost({ request, env, waitUntil }: RequestContext): Promise<Response> {
  const rawBody = await readBody(request);
  if (rawBody === BODY_TOO_LARGE) {
    return jsonError(`Request body exceeds ${MAX_BODY_BYTES} bytes`, 413, { ...JSON_HEADERS });
  }
  const payload = rawBody === BODY_UNPARSEABLE ? null : normalizePayload(rawBody);
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

  const loaded = await loadDecks(request, payload);
  if (loaded.status !== 'ok') {
    return deckFetchError(loaded, payload);
  }
  const { decks } = loaded;

  // Scope to the success bracket and archetype BEFORE canonicalizing: in the
  // fallback path `decks` is the full multi-MB decks.json, and rewriting every
  // card of every deck only to discard most decks on the archetype match was
  // the expensive order. Neither filter depends on canonical card IDs (they
  // match on placement tags and archetype name); the card-quantity filters
  // inside generateReportForFilters do, so canonicalize the survivors first.
  const successScopedDecks = filterDecksBySuccess(decks, payload.successFilter);
  const archetypeScopedDecks = filterDecks(successScopedDecks, payload.archetype, []);

  // loadCardSynonyms degrades to an empty DB on failure, in which case
  // canonicalizeDeckCard is a no-op — same behavior as before this existed.
  const synonymDb =
    env && archetypeScopedDecks.length ? await loadCardSynonyms(env) : { synonyms: {}, canonicals: {}, metadata: {} };
  const canonicalDecks = canonicalizeDecks(
    archetypeScopedDecks,
    synonymDb as Awaited<ReturnType<typeof loadCardSynonyms>>
  );

  const report = generateReportForFilters(canonicalDecks, payload.archetype, payload.filters);
  const response = jsonResponse(
    {
      deckTotal: report.deckTotal,
      items: report.items,
      raw: {
        generatedServerSide: true,
        filters: payload.filters.length,
        successFilter: payload.successFilter,
        generatedAt: new Date().toISOString()
      }
    },
    { cacheControl: RESPONSE_CACHE_CONTROL }
  );

  if (cacheRequest) {
    // Don't hold the response hostage to cache serialization when the runtime
    // lets us defer it; tests invoke the handler without waitUntil.
    const put = caches.default.put(cacheRequest, response.clone());
    if (waitUntil) {
      waitUntil(put);
    } else {
      await put;
    }
  }

  return response;
}

export function onRequestOptions(): Response {
  return corsPreflight('POST, OPTIONS');
}
