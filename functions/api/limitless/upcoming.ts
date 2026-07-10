/**
 * Upcoming tournaments — scrapes https://limitlesstcg.com/tournaments/upcoming?game=PTCG
 * and returns a clean JSON list. Edge-cached for 6 hours, so the upstream is hit at
 * most ~4× per day per cache region.
 *
 * The Limitless markup follows a stable pattern:
 *   <tr data-date="2026-05-23" data-country="PE" data-name="Special Event Lima" data-format="standard">
 *     <td>23 May 26</td>
 *     <td><img class="flag" ... alt="PE" data-tooltip="Peru"></td>
 *     <td><a href="/tournaments/536">Special Event Lima</a></td>
 *     <td><img class="format" ...></td>
 *     <td><a href="https://external.example/..."><i class="fas fa-link"></i></a></td>
 *   </tr>
 *
 * Pulling values out of data-* attributes is more reliable than parsing the
 * inner <td>s, so we lean on those.
 */

import { corsPreflight, jsonResponse } from '../../lib/api/responses.js';
import type { UpcomingEvent, UpcomingPayload } from '../../../shared/upcomingTypes';

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

  const events = parseUpcoming(html);
  // Heuristic: if the upstream had table rows but we extracted zero events, the
  // markup pattern probably changed and our regex needs updating. Surface it
  // so the frontend can show a soft warning instead of silently rendering "no events".
  const upstreamRowCount = (html.match(/<tr\b/g) ?? []).length;
  const parseWarning =
    upstreamRowCount > 1 && events.length === 0
      ? 'Upcoming-events parser extracted no events from a non-empty upstream — Limitless markup may have changed.'
      : undefined;
  const payload: UpcomingPayload = {
    refreshedAt: new Date().toISOString(),
    source: UPCOMING_URL,
    events,
    ...(parseWarning ? { parseWarning } : {})
  };

  // Edge-cache for 6h, browser-cache for 1h.
  return jsonResponse(payload, {
    cacheControl: RESPONSE_CACHE_CONTROL,
    headers: { ...JSON_CHARSET_HEADER }
  });
}

export async function onRequestOptions(): Promise<Response> {
  return corsPreflight('GET, OPTIONS', { allowHeaders: null, maxAge: 86400 });
}

const ROW_RE =
  /<tr\s+data-date="([^"]+)"\s+data-country="([^"]+)"\s+data-name="([^"]+)"\s+data-format="([^"]+)"[^>]*>([\s\S]*?)<\/tr>/g;
const LIMITLESS_LINK_RE = /<a\s+href="(\/tournaments\/[^"]+)"/;
const EXTERNAL_LINK_RE = /<a\s+href="(https?:\/\/[^"]+)"[^>]*>\s*<i\s+class="fas\s+fa-link"/;

function parseUpcoming(html: string): UpcomingEvent[] {
  const events: UpcomingEvent[] = [];
  let m: RegExpExecArray | null;
  // Reset since the regex has the /g flag and is module-scoped.
  ROW_RE.lastIndex = 0;
  while ((m = ROW_RE.exec(html)) !== null) {
    const [, date, country, name, format, body] = m;
    const limitlessMatch = body.match(LIMITLESS_LINK_RE);
    const externalMatch = body.match(EXTERNAL_LINK_RE);
    events.push({
      date,
      country,
      name: decodeHtmlEntities(name),
      format,
      type: classifyType(name),
      limitlessUrl: limitlessMatch ? `https://limitlesstcg.com${limitlessMatch[1]}` : undefined,
      externalUrl: externalMatch ? sanitizeExternalUrl(externalMatch[1]) : undefined
    });
  }
  // Already in ascending-date order on the source page, but make it explicit.
  events.sort((a, b) => a.date.localeCompare(b.date));
  return events;
}

/**
 * The href is captured raw from HTML, so it still contains entities like
 * `&amp;` that would corrupt query params (`?a=1&amp;b=2` → a broken `amp;b`).
 * Decode it, then only emit http(s) URLs — anything else (javascript:, data:,
 * malformed) is dropped rather than surfaced as a clickable link.
 */
function sanitizeExternalUrl(raw: string): string | undefined {
  const decoded = decodeHtmlEntities(raw);
  let parsed: URL;
  try {
    parsed = new URL(decoded);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return undefined;
  }
  return decoded;
}

function classifyType(name: string): UpcomingEvent['type'] {
  const lower = name.toLowerCase();
  if (lower.includes('world championship') || lower.includes('worlds')) {
    return 'worlds';
  }
  if (
    lower.includes('international') ||
    lower.includes('naic') ||
    lower.includes('eu ic') ||
    lower.includes('lac ic') ||
    lower.includes('oc ic')
  ) {
    return 'international';
  }
  if (lower.startsWith('regional') || lower.includes(' regional')) {
    return 'regional';
  }
  if (lower.includes('special event')) {
    return 'special';
  }
  return 'other';
}

const HTML_ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&nbsp;': ' '
};

function decodeHtmlEntities(s: string): string {
  return (
    s
      // Numeric entities first: decimal (&#39;) and hex (&#x27;).
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
        const code = parseInt(hex, 16);
        return Number.isFinite(code) ? String.fromCodePoint(code) : _;
      })
      .replace(/&#(\d+);/g, (_, dec) => {
        const code = parseInt(dec, 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : _;
      })
      .replace(/&[a-zA-Z]+;/g, m => HTML_ENTITY_MAP[m] ?? m)
  );
}

function jsonError(message: string, status: number): Response {
  return jsonResponse({ error: message }, { status, cacheControl: 'no-store', headers: { ...JSON_CHARSET_HEADER } });
}
