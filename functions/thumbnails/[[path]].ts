/**
 * Proxy for card art.
 * Route: /thumbnails/sm/:set/:number
 * Example: /thumbnails/sm/TEF/123 -> https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/TEF/TEF_123_R_EN_SM.png
 *
 * Vintage sets, whose scans live on pokemontcg.io instead, take the size slot's
 * `ptcgio` form:
 * Route: /thumbnails/ptcgio/:setId/:file
 * Example: /thumbnails/ptcgio/base1/94_hires -> https://images.pokemontcg.io/base1/94_hires.png
 *
 * Those images hotlink fine, so the proxy is not there to make them load — it
 * is there to make them READABLE. images.pokemontcg.io sends no CORS header, so
 * a hotlinked scan cannot be inlined into a canvas or a DOM rasterise, and the
 * tier list exported every vintage print as an empty frame. Same origin, same
 * edge cache, and the art comes back with the rest of the page.
 */

import { corsPreflight } from '../lib/api/responses.js';

const LIMITLESS_CDN_BASE = 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci';
const PTCGIO_BASE = 'https://images.pokemontcg.io';
const CACHE_TTL = 86400; // 24 hours (edge fetch TTL)
// Card art for a given set/number never changes, so let browsers cache it for a
// year and skip revalidation entirely.
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

// Validation patterns
const SET_CODE_PATTERN = /^[A-Z0-9]{2,8}$/;
// Plain numbers (123, 18a) or letter-prefixed gallery numbers (TG24, GG05, SV107).
const CARD_NUMBER_PATTERN = /^(?:[0-9]+[A-Za-z]*|[A-Za-z]{1,4}[0-9]+)$/;
// pokemontcg.io set ids (base1, ecard2, xyp) and file stems (94, XY27, 94_hires).
const PTCGIO_SET_ID_PATTERN = /^[a-z][a-z0-9]{1,11}$/;
const PTCGIO_FILE_PATTERN = /^[A-Za-z]{0,4}[0-9]+[A-Za-z]?(?:_hires)?$/;

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
  if (parts) {
    const [, digits, suffix = ''] = parts;
    const paddedDigits = digits.padStart(3, '0');
    // Variant suffixes are lowercase in the CDN filenames (SLG_068a,
    // UNB_182a) and the CDN is case-sensitive.
    const lowerSuffix = suffix.toLowerCase();
    return {
      trimmed: `${digits}${lowerSuffix}`,
      padded: `${paddedDigits}${lowerSuffix}`
    };
  }

  // Letter-prefixed gallery numbers (trainer/character galleries: LOR_TG24,
  // CRZ_GG05). Limitless pads their digits to 2, so probe that form first and
  // fall back to the raw form for three-digit galleries like SV107.
  const prefixed = withoutLeadingZeros.match(/^([A-Za-z]+)0*(\d+)$/);
  if (prefixed) {
    const prefix = prefixed[1].toUpperCase();
    return {
      trimmed: withoutLeadingZeros.toUpperCase(),
      padded: `${prefix}${prefixed[2].padStart(2, '0')}`
    };
  }

  return { trimmed: withoutLeadingZeros, padded: withoutLeadingZeros };
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

function textError(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }
  });
}

/**
 * Fetches the first candidate that exists and hands it back under our own
 * origin: CORS open, cookies stripped, cached forever.
 */
async function deliver(candidateUrls: string[]): Promise<Response> {
  try {
    const response = await fetchWithFallback(candidateUrls);

    // Clone the response to add CORS headers.
    const headers = new Headers(response.headers);
    // Drop Limitless/Cloudflare's `__cf_bm` bot-management cookie. Its Domain is
    // set to the public suffix `digitaloceanspaces.com`, which browsers reject
    // ("invalid domain") — and once rejected, concurrent direct-to-CDN image
    // loads get 403-challenged, which is why hotlinking broke in the browser.
    // Passing it through here is both useless (wrong domain for our origin) and
    // harmful: Cloudflare will not edge-cache any response carrying Set-Cookie,
    // so leaving it in would invoke this Function on every single image view.
    // Stripping it makes the response cacheable, so repeat views are free.
    headers.delete('Set-Cookie');
    headers.delete('Vary');
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    headers.set('Cache-Control', IMMUTABLE_CACHE_CONTROL);
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
    return textError(`Failed to fetch image: ${message}`, 500);
  }
}

/** `/thumbnails/ptcgio/:setId/:file` — the set id and file stem are theirs, not ours. */
function ptcgio(setId: string, file: string): Promise<Response> {
  const id = setId.trim().toLowerCase();
  const stem = file.trim();
  if (!PTCGIO_SET_ID_PATTERN.test(id) || !PTCGIO_FILE_PATTERN.test(stem)) {
    return Promise.resolve(textError('Invalid pokemontcg.io set or file.', 400));
  }
  return deliver([`${PTCGIO_BASE}/${id}/${stem}.png`]);
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

  // Vintage art comes from pokemontcg.io, which names its files nothing like
  // Limitless does — so it gets its own parse rather than a shared one bent
  // around both.
  if (size.toLowerCase() === 'ptcgio') {
    return ptcgio(set, number);
  }

  // Validate size
  const sizeUpper = size.toUpperCase();
  if (sizeUpper !== 'SM' && sizeUpper !== 'XS' && sizeUpper !== 'LG') {
    return textError('Invalid size. Must be "sm", "xs", or "lg"', 400);
  }

  const setCode = set.toUpperCase().trim();

  // Validate set code format (2-8 uppercase alphanumeric characters)
  if (!SET_CODE_PATTERN.test(setCode)) {
    return textError('Invalid set code format. Must be 2-8 alphanumeric characters.', 400);
  }

  // Validate card number format before normalization
  const rawNumber = String(number ?? '').trim();
  if (!rawNumber || !CARD_NUMBER_PATTERN.test(rawNumber.replace(/^0+/, '') || '0')) {
    return textError('Invalid card number format.', 400);
  }

  const { trimmed, padded } = normalizeCardNumber(number);

  if (!setCode || !trimmed) {
    return textError('Invalid set or number', 400);
  }

  // Limitless uses zero-padded 3-digit numbers (e.g. TEF_007), so probe the
  // padded form first — the trimmed/unpadded form 404s for any number < 100.
  const candidateNumbers = Array.from(new Set([padded, trimmed].filter(Boolean) as string[]));
  return deliver(
    candidateNumbers.map(
      cardNumber => `${LIMITLESS_CDN_BASE}/${setCode}/${setCode}_${cardNumber}_R_EN_${sizeUpper}.png`
    )
  );
}

// Handle OPTIONS for CORS preflight
export async function onRequestOptions(): Promise<Response> {
  return corsPreflight('GET, OPTIONS', { maxAge: 86400 });
}
