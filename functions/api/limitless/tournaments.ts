import { fetchLimitlessJson } from '../../lib/limitless.js';

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

function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
      ...extraHeaders
    }
  });
}

export async function onRequestGet({ request, env }: RequestContext): Promise<Response> {
  try {
    const url = new URL(request.url);
    const query = buildProxySearchParams(url);

    const data = await fetchLimitlessJson('/tournaments', {
      env,
      searchParams: query
    });

    return jsonResponse({
      success: true,
      source: 'limitless',
      receivedAt: new Date().toISOString(),
      query: Object.fromEntries(query.entries()),
      data
    });
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
      status,
      { 'Cache-Control': 'no-store' }
    );
  }
}

export function onRequestOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
