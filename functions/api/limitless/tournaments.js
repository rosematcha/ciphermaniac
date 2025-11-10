import { fetchLimitlessJson } from '../../lib/limitless.js';

const ALLOWED_QUERY_PARAMS = ['game', 'format', 'organizerId', 'limit', 'page'];

function buildProxySearchParams(url) {
  const scoped = new URLSearchParams();
  ALLOWED_QUERY_PARAMS.forEach(param => {
    const value = url.searchParams.get(param);
    if (value !== null && value !== undefined && String(value).trim() !== '') {
      scoped.set(param, value);
    }
  });
  return scoped;
}

function jsonResponse(body, status = 200, extraHeaders = {}) {
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

export async function onRequestGet({ request, env }) {
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
      message: error?.message,
      status: error?.status,
      body: error?.body
    });

    const status = Number.isInteger(error?.status) ? error.status : 502;
    return jsonResponse(
      {
        success: false,
        error: 'Failed to fetch Limitless tournaments',
        message: error?.message || 'Unknown error'
      },
      status,
      { 'Cache-Control': 'no-store' }
    );
  }
}

export function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
