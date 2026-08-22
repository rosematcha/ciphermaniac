/**
 * Parser for the Limitless "upcoming tournaments" page.
 *
 * HTML scraping is brittle by nature, so the parsing lives here as a pure
 * function over a string rather than inside the network route. That makes the
 * fragile part testable against fixture markup — including the markup changes
 * that would break it — while the route stays a thin
 * `fetch -> parse -> respond`.
 *
 * The upstream markup follows a stable pattern:
 *
 *   <tr data-date="2026-05-23" data-country="PE" data-name="Special Event Lima" data-format="standard">
 *     <td>23 May 26</td>
 *     <td><img class="flag" alt="PE" data-tooltip="Peru"></td>
 *     <td><a href="/tournaments/536">Special Event Lima</a></td>
 *     <td><img class="format"></td>
 *     <td><a href="https://external.example/..."><i class="fas fa-link"></i></a></td>
 *   </tr>
 *
 * Reading the `data-*` attributes is more reliable than parsing the inner
 * `<td>`s, but the attributes are extracted INDEPENDENTLY rather than by one
 * fixed-order pattern: a reordered attribute or a line break between attributes
 * is a cosmetic upstream change that must not empty the whole list.
 *
 * Isomorphic — no environment-specific dependencies.
 * @module shared/api/upcomingParser
 */

import type { UpcomingEvent } from '../upcomingTypes';

/** Opening `<tr ...>` tag plus its row body, whitespace- and order-tolerant. */
const ROW_RE = /<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi;

const LIMITLESS_LINK_RE = /<a\s[^>]*href="(\/tournaments\/[^"]+)"/i;
const EXTERNAL_LINK_RE = /<a\s[^>]*href="(https?:\/\/[^"]+)"[^>]*>\s*<i\s[^>]*class="[^"]*fa-link/i;

/** Read one `data-*` attribute out of a raw tag-attribute string. */
function attr(attrs: string, name: string): string | null {
  const match = attrs.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i'));
  return match ? match[1] : null;
}

const HTML_ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&nbsp;': ' '
};

export function decodeHtmlEntities(s: string): string {
  return (
    s
      // Numeric entities first: decimal (&#39;) and hex (&#x27;).
      .replace(/&#x([0-9a-fA-F]+);/g, (whole, hex: string) => {
        const code = parseInt(hex, 16);
        return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
      })
      .replace(/&#(\d+);/g, (whole, dec: string) => {
        const code = parseInt(dec, 10);
        return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
      })
      .replace(/&[a-zA-Z]+;/g, m => HTML_ENTITY_MAP[m] ?? m)
  );
}

/**
 * The href is captured raw from HTML, so it still contains entities like
 * `&amp;` that would corrupt query params (`?a=1&amp;b=2` → a broken `amp;b`).
 * Decode it, then only emit http(s) URLs — anything else (javascript:, data:,
 * malformed) is dropped rather than surfaced as a clickable link.
 */
export function sanitizeExternalUrl(raw: string): string | undefined {
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

export function classifyType(name: string): UpcomingEvent['type'] {
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

/** What {@link parseUpcoming} saw, so callers can tell "no events" from "broken". */
export interface UpcomingParseResult {
  events: UpcomingEvent[];
  /** `<tr` occurrences in the source, including the header row. */
  rowsSeen: number;
  /** Rows that looked like event rows but lacked a required attribute. */
  rowsSkipped: number;
}

/**
 * Extract upcoming events from the Limitless page HTML.
 *
 * A row needs a `data-date` and a `data-name` to be an event; anything else
 * (the header row, layout rows, a row whose attributes the upstream renamed) is
 * counted in `rowsSkipped` rather than emitted as a half-built event.
 * @param html - Raw page HTML
 * @returns The parsed events plus enough counts to detect structural breakage
 */
export function parseUpcoming(html: string): UpcomingParseResult {
  const events: UpcomingEvent[] = [];
  let rowsSeen = 0;
  let rowsSkipped = 0;

  ROW_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ROW_RE.exec(html)) !== null) {
    rowsSeen += 1;
    const [, attrs, body] = match;
    const date = attr(attrs, 'data-date');
    const name = attr(attrs, 'data-name');
    if (!date || !name) {
      // Header rows have no data-* attributes at all and are not "skipped"
      // in the interesting sense; a row carrying SOME data-* but missing a
      // required one is the signal that the markup moved.
      if (attr(attrs, 'data-country') || attr(attrs, 'data-format')) {
        rowsSkipped += 1;
      }
      continue;
    }

    const limitlessMatch = body.match(LIMITLESS_LINK_RE);
    const externalMatch = body.match(EXTERNAL_LINK_RE);
    events.push({
      date,
      country: attr(attrs, 'data-country') ?? '',
      name: decodeHtmlEntities(name),
      format: attr(attrs, 'data-format') ?? '',
      type: classifyType(name),
      limitlessUrl: limitlessMatch ? `https://limitlesstcg.com${limitlessMatch[1]}` : undefined,
      externalUrl: externalMatch ? sanitizeExternalUrl(externalMatch[1]) : undefined
    });
  }

  // Already in ascending-date order on the source page, but make it explicit.
  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { events, rowsSeen, rowsSkipped };
}

/**
 * Decide whether a parse result indicates the upstream markup changed.
 *
 * A page with rows but no extracted events, or one where recognizable event
 * rows were skipped, is structural breakage — not an authoritative "no events
 * scheduled". Returning zero silently is the failure mode worth catching: it
 * looks exactly like a quiet off-season.
 * @param result - Output of {@link parseUpcoming}
 * @returns A warning string, or undefined when the parse looks healthy
 */
export function detectParseBreakage(result: UpcomingParseResult): string | undefined {
  if (result.rowsSkipped > 0) {
    return `Upcoming-events parser skipped ${result.rowsSkipped} row(s) missing a required attribute — Limitless markup may have changed.`;
  }
  // >1 because a table with only a header row is a genuinely empty schedule.
  if (result.rowsSeen > 1 && result.events.length === 0) {
    return 'Upcoming-events parser extracted no events from a non-empty upstream — Limitless markup may have changed.';
  }
  return undefined;
}
