/**
 * Proxy for Limitless CDN card thumbnails
 * Route: /thumbnails/sm/:set/:number
 * Example: /thumbnails/sm/TEF/123 -> https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/TEF/TEF_123_R_EN_SM.png
 */

const LIMITLESS_CDN_BASE = 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci';
const CACHE_TTL = 86400; // 24 hours

function normalizeCardNumber(raw) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) {
    return { trimmed: null, padded: null };
  }

  const withoutLeadingZeros = trimmed.replace(/^0+/, '') || '0';
  const parts = withoutLeadingZeros.match(/^(\d+)([A-Za-z]*)$/);
  if (!parts) {
    return { trimmed: withoutLeadingZeros, padded: withoutLeadingZeros };
  }

  const [, digits, suffix = '' ] = parts;
  const paddedDigits = digits.padStart(3, '0');
  return {
    trimmed: withoutLeadingZeros,
    padded: `${paddedDigits}${suffix}`
  };
}

async function fetchWithFallback(urls) {
  let lastStatus = 404;
  for (const url of urls) {
    const response = await fetch(url, {
      cf: { cacheTtl: CACHE_TTL, cacheEverything: true }
    });

    if (response.ok) {
      return response;
    }

    lastStatus = response.status;
  }

  throw new Response('Image not found', {
    status: lastStatus,
    headers: { 'Content-Type': 'text/plain' }
  });
}

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  // Parse URL path: /thumbnails/sm/TEF/123
  const pathParts = url.pathname.split('/').filter(Boolean);

  // Remove 'thumbnails' prefix, expect [size, set, number]
  const relevantParts = pathParts.slice(1);

  if (relevantParts.length !== 3) {
    return new Response(`Invalid path format. Expected: /thumbnails/{size}/{set}/{number}, got: ${url.pathname}`, {
      status: 400,
      headers: { 'Content-Type': 'text/plain' }
    });
  }

  const [size, set, number] = relevantParts;

  // Validate size
  const sizeUpper = size.toUpperCase();
  if (sizeUpper !== 'SM' && sizeUpper !== 'XS') {
    return new Response('Invalid size. Must be "sm" or "xs"', {
      status: 400,
      headers: { 'Content-Type': 'text/plain' }
    });
  }

  const setCode = set.toUpperCase().trim();
  const { trimmed, padded } = normalizeCardNumber(number);

  if (!setCode || !trimmed) {
    return new Response('Invalid set or number', {
      status: 400,
      headers: { 'Content-Type': 'text/plain' }
    });
  }

  const candidateNumbers = Array.from(new Set([trimmed, padded].filter(Boolean)));
  const candidateUrls = candidateNumbers.map(cardNumber => `${LIMITLESS_CDN_BASE}/${setCode}/${setCode}_${cardNumber}_R_EN_${sizeUpper}.png`);

  try {
    const response = await fetchWithFallback(candidateUrls);

    // Clone the response to add CORS headers
    const headers = new Headers(response.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    headers.set('Cache-Control', `public, max-age=${CACHE_TTL}`);
    headers.set('Content-Type', 'image/png');

    return new Response(response.body, {
      status: response.status,
      headers
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    return new Response(`Failed to fetch image: ${error.message}`, {
      status: 500,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

// Handle OPTIONS for CORS preflight
export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    }
  });
}
