/**
 * Proxy for Limitless CDN card thumbnails
 * Route: /thumbnails/sm/:set/:number
 * Example: /thumbnails/sm/TEF/123 -> https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/TEF/TEF_123_R_EN_SM.png
 */

const LIMITLESS_CDN_BASE = 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci';
const CACHE_TTL = 86400; // 24 hours

// Validation patterns
const SET_CODE_PATTERN = /^[A-Z0-9]{2,8}$/;
const CARD_NUMBER_PATTERN = /^[0-9]+[A-Za-z]*$/;

interface Context {
  request: Request;
}

type CfRequestInit = RequestInit & { cf?: unknown };

function normalizeCardNumber(raw: unknown): { trimmed: string | null; padded: string | null } {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) {
    return { trimmed: null, padded: null };
  }

  const withoutLeadingZeros = trimmed.replace(/^0+/, '') || '0';
  const parts = withoutLeadingZeros.match(/^(\d+)([A-Za-z]*)$/);
  if (!parts) {
    return { trimmed: withoutLeadingZeros, padded: withoutLeadingZeros };
  }

  const [, digits, suffix = ''] = parts;
  const paddedDigits = digits.padStart(3, '0');
  return {
    trimmed: withoutLeadingZeros,
    padded: `${paddedDigits}${suffix}`
  };
}

async function fetchWithFallback(urls: string[]): Promise<Response> {
  let lastStatus = 404;
  for (const url of urls) {
    const requestInit: CfRequestInit = {
      cf: { cacheTtl: CACHE_TTL, cacheEverything: true }
    };
    const response = await fetch(url, requestInit);

    if (response.ok) {
      return response;
    }

    lastStatus = response.status;
  }

  throw new Response('Image not found', {
    status: lastStatus,
    headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }
  });
}

export async function onRequest(context: Context): Promise<Response> {
  const { request } = context;
  const url = new URL(request.url);

  // Parse URL path: /thumbnails/sm/TEF/123
  const pathParts = url.pathname.split('/').filter(Boolean);

  // Remove 'thumbnails' prefix, expect [size, set, number]
  const relevantParts = pathParts.slice(1);

  if (relevantParts.length !== 3) {
    return new Response(`Invalid path format. Expected: /thumbnails/{size}/{set}/{number}, got: ${url.pathname}`, {
      status: 400,
      headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }
    });
  }

  const [size, set, number] = relevantParts;

  // Validate size
  const sizeUpper = size.toUpperCase();
  if (sizeUpper !== 'SM' && sizeUpper !== 'XS') {
    return new Response('Invalid size. Must be "sm" or "xs"', {
      status: 400,
      headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }
    });
  }

  const setCode = set.toUpperCase().trim();

  // Validate set code format (2-8 uppercase alphanumeric characters)
  if (!SET_CODE_PATTERN.test(setCode)) {
    return new Response('Invalid set code format. Must be 2-8 alphanumeric characters.', {
      status: 400,
      headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }
    });
  }

  // Validate card number format before normalization
  const rawNumber = String(number ?? '').trim();
  if (!rawNumber || !CARD_NUMBER_PATTERN.test(rawNumber.replace(/^0+/, '') || '0')) {
    return new Response('Invalid card number format.', {
      status: 400,
      headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }
    });
  }

  const { trimmed, padded } = normalizeCardNumber(number);

  if (!setCode || !trimmed) {
    return new Response('Invalid set or number', {
      status: 400,
      headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }
    });
  }

  const candidateNumbers = Array.from(new Set([trimmed, padded].filter(Boolean) as string[]));
  const candidateUrls = candidateNumbers.map(
    cardNumber => `${LIMITLESS_CDN_BASE}/${setCode}/${setCode}_${cardNumber}_R_EN_${sizeUpper}.png`
  );

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

    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(`Failed to fetch image: ${message}`, {
      status: 500,
      headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }
    });
  }
}

// Handle OPTIONS for CORS preflight
export async function onRequestOptions(): Promise<Response> {
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
