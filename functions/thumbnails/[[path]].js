/**
 * Proxy for Limitless CDN card thumbnails
 * Route: /thumbnails/sm/:set/:number
 * Example: /thumbnails/sm/TEF/123 -> https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/TEF/TEF_123_R_EN_SM.png
 */

const LIMITLESS_CDN_BASE = 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci';
const CACHE_TTL = 86400; // 24 hours

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const pathParts = context.params.path;

  // Parse path: expecting ["sm" or "xs", set, number]
  if (!Array.isArray(pathParts) || pathParts.length < 3) {
    return new Response('Invalid path format. Expected: /thumbnails/{size}/{set}/{number}', {
      status: 400,
      headers: { 'Content-Type': 'text/plain' }
    });
  }

  const [size, set, number] = pathParts;

  // Validate size
  const sizeUpper = size.toUpperCase();
  if (sizeUpper !== 'SM' && sizeUpper !== 'XS') {
    return new Response('Invalid size. Must be "sm" or "xs"', {
      status: 400,
      headers: { 'Content-Type': 'text/plain' }
    });
  }

  // Validate set and number
  const setCode = set.toUpperCase().trim();
  const cardNumber = String(number).trim().replace(/^0+/, '') || '0';

  if (!setCode || !cardNumber) {
    return new Response('Invalid set or number', {
      status: 400,
      headers: { 'Content-Type': 'text/plain' }
    });
  }

  // Build Limitless CDN URL
  const limitlessUrl = `${LIMITLESS_CDN_BASE}/${setCode}/${setCode}_${cardNumber}_R_EN_${sizeUpper}.png`;

  try {
    // Fetch from Limitless CDN
    const response = await fetch(limitlessUrl, {
      cf: {
        cacheTtl: CACHE_TTL,
        cacheEverything: true
      }
    });

    if (!response.ok) {
      return new Response(`Image not found: ${limitlessUrl}`, {
        status: 404,
        headers: { 'Content-Type': 'text/plain' }
      });
    }

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
