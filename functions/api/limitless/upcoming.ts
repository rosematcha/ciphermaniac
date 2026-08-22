/**
 * Upcoming tournaments — fetches https://limitlesstcg.com/tournaments/upcoming?game=PTCG
 * and returns a clean JSON list. Edge-cached for 6 hours, so the upstream is hit
 * at most ~4x per day per cache region.
 *
 * Deliberately thin: fetch -> parse -> respond. The scraping lives in
 * shared/api/upcomingParser so the brittle part is unit-testable against
 * fixture markup instead of only against whatever Limitless is serving today.
 */

import { detectParseBreakage, parseUpcoming } from '../../../shared/api/upcomingParser.js';
import { corsPreflight, jsonResponse } from '../../lib/api/responses.js';
import type { UpcomingPayload } from '../../../shared/upcomingTypes';

const UPCOMING_URL = 'https://limitlesstcg.com/tournaments/upcoming?game=PTCG';
const CACHE_TTL_SECONDS = 60 * 60 * 6; // 6 hours

type CfRequestInit = RequestInit & { cf?: unknown };

// Upcoming events change rarely; browser-cache 1h, edge-cache 6h.
const RESPONSE_CACHE_CONTROL = `public, max-age=3600, s-maxage=${CACHE_TTL_SECONDS}`;
const JSON_CHARSET_HEADER = { 'Content-Type': 'application/json; charset=utf-8' } as const;

interface Context {
  request: Request;
}

export async function onRequest(_context: Context): Promise<Response> {
  let html: string;
  try {
    const init: CfRequestInit = {
      cf: { cacheTtl: CACHE_TTL_SECONDS, cacheEverything: true },
      headers: {
        // A real-looking UA avoids any over-eager bot blocking on Limitless's side.
        'User-Agent': 'Mozilla/5.0 (compatible; Ciphermaniac/1.0; +https://ciphermaniac.com)',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    };
    const response = await fetch(UPCOMING_URL, init);
    if (!response.ok) {
      return jsonError(`Upstream ${response.status}`, 502);
    }
    html = await response.text();
  } catch (err) {
    return jsonError(`Fetch failed: ${err instanceof Error ? err.message : String(err)}`, 502);
  }

  const result = parseUpcoming(html);
  // Structural breakage must not read as an authoritative empty schedule, so it
  // is both logged for us and surfaced to the frontend as a soft warning.
  const parseWarning = detectParseBreakage(result);
  if (parseWarning) {
    console.warn(`upcoming: ${parseWarning} rowsSeen=${result.rowsSeen} rowsSkipped=${result.rowsSkipped}`);
  }

  const payload: UpcomingPayload = {
    refreshedAt: new Date().toISOString(),
    source: UPCOMING_URL,
    events: result.events,
    ...(parseWarning ? { parseWarning } : {})
  };

  return jsonResponse(payload, {
    cacheControl: RESPONSE_CACHE_CONTROL,
    headers: { ...JSON_CHARSET_HEADER }
  });
}

export async function onRequestOptions(): Promise<Response> {
  return corsPreflight('GET, OPTIONS', { allowHeaders: null, maxAge: 86400 });
}

function jsonError(message: string, status: number): Response {
  return jsonResponse({ error: message }, { status, cacheControl: 'no-store', headers: { ...JSON_CHARSET_HEADER } });
}
