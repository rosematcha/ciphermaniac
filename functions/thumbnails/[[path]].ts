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
 *
 * Japanese-only prints (set codes `JP-…`, see shared/data/japanOnlyCards) are
 * Limitless's Japanese scans:
 * Example: /thumbnails/sm/JP-M6/062 -> https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpc/M6/M6_62_R_JP_SM.png
 */

import { corsPreflight, IMAGE_FETCH_INIT, imageProxyResponse, textError } from '../lib/api/responses.js';
import { isJapanOnlySet, japaneseSetOf, limitlessJpSetCandidates } from '../../shared/data/japanOnlyCards';

const LIMITLESS_CDN_BASE = 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci';
const LIMITLESS_JP_CDN_BASE = 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpc';
const PTCGIO_BASE = 'https://images.pokemontcg.io';
// Validation patterns
const SET_CODE_PATTERN = /^[A-Z0-9]{2,8}$/;
// Plain numbers (123, 18a), letter-prefixed gallery numbers (TG24, GG05, SV107),
// or the lone type letter SUM/TEU/SSH/BRS give their unnumbered basic Energy
// (stored as 000P, filed on the CDN as TEU_P).
const CARD_NUMBER_PATTERN = /^(?:[0-9]+[A-Za-z]*|[A-Za-z]{1,4}[0-9]+|[A-Za-z])$/;
// pokemontcg.io set ids (base1, ecard2, xyp) and file stems (94, XY27, 94_hires).
const PTCGIO_SET_ID_PATTERN = /^[a-z][a-z0-9]{1,11}$/;
const PTCGIO_FILE_PATTERN = /^[A-Za-z]{0,4}[0-9]+[A-Za-z]?(?:_hires)?$/;

interface Context {
  request: Request;
}

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
    const response = await fetch(url, IMAGE_FETCH_INIT);

    if (response.ok) {
      return response;
    }

    lastStatus = response.status;
  }

  throw textError('Image not found', lastStatus);
}

/**
 * Fetches the first candidate that exists and hands it back under our own
 * origin: CORS open, cookies stripped, cached forever.
 */
async function deliver(candidateUrls: string[]): Promise<Response> {
  try {
    const response = await fetchWithFallback(candidateUrls);

    return imageProxyResponse(response);
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

/** `/thumbnails/:size/:SET/:number` — an English print on the Limitless CDN. */
function limitless(setCode: string, number: string, sizeUpper: string): Promise<Response> {
  // Validate set code format (2-8 uppercase alphanumeric characters)
  if (!SET_CODE_PATTERN.test(setCode)) {
    return Promise.resolve(textError('Invalid set code format. Must be 2-8 alphanumeric characters.', 400));
  }

  // Validate card number format before normalization
  const rawNumber = String(number ?? '').trim();
  if (!rawNumber || !CARD_NUMBER_PATTERN.test(rawNumber.replace(/^0+/, '') || '0')) {
    return Promise.resolve(textError('Invalid card number format.', 400));
  }

  const { trimmed, padded } = normalizeCardNumber(number);

  if (!trimmed) {
    return Promise.resolve(textError('Invalid set or number', 400));
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

/**
 * `/thumbnails/:size/JP-:SET/:number` — Limitless's Japanese scan of a card
 * with no English print yet. CardImage asks for it only when our copy of the
 * fan-translated image is missing. Japanese scans are filed unpadded
 * (`M6_62`), and a few set codes carry a lowercase suffix (`M6a`).
 */
function japanese(setCode: string, number: string, sizeUpper: string): Promise<Response> {
  const jpSet = japaneseSetOf(setCode);
  const digits = String(number ?? '')
    .trim()
    .replace(/^0+(?=\d)/, '');
  if (!SET_CODE_PATTERN.test(jpSet) || !/^\d{1,4}$/.test(digits)) {
    return Promise.resolve(textError('Invalid Japanese set or card number.', 400));
  }
  return deliver(
    limitlessJpSetCandidates(jpSet).map(
      code => `${LIMITLESS_JP_CDN_BASE}/${code}/${code}_${digits}_R_JP_${sizeUpper}.png`
    )
  );
}

export async function onRequest(context: Context): Promise<Response> {
  const url = new URL(context.request.url);

  // Parse URL path: /thumbnails/sm/TEF/123, dropping the 'thumbnails' prefix
  const relevantParts = url.pathname.split('/').filter(Boolean).slice(1);

  if (relevantParts.length !== 3) {
    return textError(`Invalid path format. Expected: /thumbnails/{size}/{set}/{number}, got: ${url.pathname}`, 400);
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
  return isJapanOnlySet(setCode) ? japanese(setCode, number, sizeUpper) : limitless(setCode, number, sizeUpper);
}

// Handle OPTIONS for CORS preflight
export async function onRequestOptions(): Promise<Response> {
  return corsPreflight('GET, OPTIONS', { maxAge: 86400 });
}
