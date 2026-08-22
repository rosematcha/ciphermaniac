import { fetchLimitlessJson } from '../../../shared/api/limitless.js';
import { corsPreflight, jsonResponse } from '../../lib/api/responses.js';

// Edge/browser cache 5 minutes, serve stale for up to an hour while revalidating.
const RESPONSE_CACHE_CONTROL = 'public, max-age=300, stale-while-revalidate=3600';

type AllowedQueryParam = 'game' | 'format' | 'organizerId' | 'limit' | 'page';

const ALLOWED_QUERY_PARAMS: AllowedQueryParam[] = ['game', 'format', 'organizerId', 'limit', 'page'];

// Numeric params get parsed and clamped rather than forwarded as-is. An
// allowlist of NAMES is not an allowlist of VALUES: `limit=1000000` or
// `page=-5` used to reach Limitless verbatim, letting a caller use this proxy
// (which carries our API key) to hammer or confuse the upstream.
const NUMERIC_BOUNDS: Partial<Record<AllowedQueryParam, { min: number; max: number }>> = {
  limit: { min: 1, max: 100 },
  page: { min: 1, max: 500 }
};

// Free-text params are bounded too — a megabyte-long `format` is nobody's
// honest query.
const MAX_TEXT_PARAM_LENGTH = 64;

/** Sentinel: a param was present but out of range → reject the request. */
const OUT_OF_RANGE = Symbol('out-of-range');

function normalizeParam(param: AllowedQueryParam, raw: string): string | typeof OUT_OF_RANGE {
  const bounds = NUMERIC_BOUNDS[param];
  if (!bounds) {
    return raw.length > MAX_TEXT_PARAM_LENGTH ? OUT_OF_RANGE : raw;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < bounds.min || value > bounds.max) {
    return OUT_OF_RANGE;
  }
  return String(value);
}

interface Env {
  LIMITLESS_API_KEY?: string;
  [key: string]: unknown;
}

interface RequestContext {
  request: Request;
  env: Env;
}

function buildProxySearchParams(url: URL): URLSearchParams | typeof OUT_OF_RANGE {
  const scoped = new URLSearchParams();
  for (const param of ALLOWED_QUERY_PARAMS) {
    const raw = url.searchParams.get(param);
    if (raw === null || raw.trim() === '') {
      continue;
    }
    const normalized = normalizeParam(param, raw.trim());
    if (normalized === OUT_OF_RANGE) {
      return OUT_OF_RANGE;
    }
    scoped.set(param, normalized);
  }
  return scoped;
}

export async function onRequestGet({ request, env }: RequestContext): Promise<Response> {
  try {
    const url = new URL(request.url);
    const query = buildProxySearchParams(url);
    if (query === OUT_OF_RANGE) {
      return jsonResponse(
        {
          success: false,
          error: 'Invalid query parameter',
          message: `limit must be ${NUMERIC_BOUNDS.limit!.min}-${NUMERIC_BOUNDS.limit!.max}, page must be ${NUMERIC_BOUNDS.page!.min}-${NUMERIC_BOUNDS.page!.max}`
        },
        { status: 400, cacheControl: 'no-store' }
      );
    }

    const data = await fetchLimitlessJson('/tournaments', {
      env,
      searchParams: query
    });

    return jsonResponse(
      {
        success: true,
        source: 'limitless',
        receivedAt: new Date().toISOString(),
        query: Object.fromEntries(query.entries()),
        data
      },
      { cacheControl: RESPONSE_CACHE_CONTROL }
    );
  } catch (error) {
    console.error('Limitless tournaments proxy failed', {
      message: (error as Error)?.message,
      status: (error as { status?: number })?.status,
      body: (error as { body?: unknown })?.body
    });

    const status = Number.isInteger((error as { status?: number })?.status)
      ? (error as { status: number }).status
      : 502;
    return jsonResponse(
      {
        success: false,
        error: 'Failed to fetch Limitless tournaments',
        message: (error as Error)?.message || 'Unknown error'
      },
      { status, cacheControl: 'no-store' }
    );
  }
}

export function onRequestOptions(): Response {
  return corsPreflight('GET, OPTIONS');
}
