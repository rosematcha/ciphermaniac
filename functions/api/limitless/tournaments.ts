import { fetchLimitlessJson } from '../../../shared/api/limitless.js';
import { corsPreflight, jsonResponse } from '../../lib/api/responses.js';

// Edge/browser cache 5 minutes, serve stale for up to an hour while revalidating.
const RESPONSE_CACHE_CONTROL = 'public, max-age=300, stale-while-revalidate=3600';

type AllowedQueryParam = 'game' | 'format' | 'organizerId' | 'limit' | 'page';

const ALLOWED_QUERY_PARAMS: AllowedQueryParam[] = ['game', 'format', 'organizerId', 'limit', 'page'];

interface Env {
  LIMITLESS_API_KEY?: string;
  [key: string]: unknown;
}

interface RequestContext {
  request: Request;
  env: Env;
}

function buildProxySearchParams(url: URL): URLSearchParams {
  const scoped = new URLSearchParams();
  ALLOWED_QUERY_PARAMS.forEach(param => {
    const value = url.searchParams.get(param);
    if (value !== null && value !== undefined && String(value).trim() !== '') {
      scoped.set(param, value);
    }
  });
  return scoped;
}

export async function onRequestGet({ request, env }: RequestContext): Promise<Response> {
  try {
    const url = new URL(request.url);
    const query = buildProxySearchParams(url);

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
