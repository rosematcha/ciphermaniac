/**
 * Parser for RK9's event list (`rk9.gg/events/pokemon`), which is where the
 * live schedule comes from: each upcoming event's dates, name, and the ID of
 * its TCG tournament, which is also its pairings ID.
 *
 * One row, with the page's runs of blank lines removed:
 *
 *   <tr>
 *     <td>September 26-27, 2026</td>
 *     <td><img src="/static/images/pokemon_regional_championships_RGB_72dpi.png"></td>
 *     <td><a href="/event/pokemon-brisbane-2027">2027 Brisbane Pokémon Regional Championships</a>...</td>
 *     <td>South Brisbane, AU</td>
 *     <td><a href="/tournament/BR003-...">...pokemon-go-300.png... GO</a>
 *         <a href="/tournament/BR001-...">...pokemon-tcg-300.png... TCG</a>...</td>
 *   </tr>
 *
 * Only Regional, International and World Championships are kept; Special
 * Championships and anything else RK9 runs are not followed live. Past events
 * carry no tournament links and drop out on their own. The page is megabytes of
 * whitespace, so rows are cut with `indexOf` rather than one regex over it all.
 *
 * Isomorphic — no environment-specific dependencies.
 * @module shared/live/rk9Events
 */

import { decodeHtmlEntities } from '../api/upcomingParser';
import type { LiveEvent, LiveEventKind } from './types';

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december'
];

const KINDS: [RegExp, LiveEventKind][] = [
  [/\bRegional Championships?\b/i, 'regional'],
  [/\bInternational Championships?\b/i, 'international'],
  [/\bWorld Championships?\b/i, 'worlds']
];

/** RK9 has always numbered the Masters pod 2. */
const MASTERS_POD = 2;

const EVENT_LINK_RE = /<a\b[^>]*\bhref="\/event\/pokemon-([a-z0-9-]+)"[^>]*>([^<]*)<\/a>/i;
const FIRST_CELL_RE = /<td\b[^>]*>([^<]*)<\/td>/i;
const TOURNAMENT_HREF = 'href="/tournament/';

export interface Rk9EventsParse {
  events: LiveEvent[];
  /** Rows that link to an event, whether or not they were kept. */
  rowsSeen: number;
  /** Event rows whose dates or name could not be read. */
  rowsUnreadable: number;
}

function isoDay(year: number, monthName: string, day: number): string | null {
  const month = MONTHS.indexOf(monthName.toLowerCase());
  if (month < 0 || !(day >= 1 && day <= 31)) {
    return null;
  }
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * `September 18-20, 2026`, `October 31-November 1, 2026`, `June 6, 2026`, and a
 * range across new year, `December 30, 2026-January 1, 2027`.
 */
export function parseRk9Dates(text: string): { firstDay: string; lastDay: string } | null {
  const match = /^([A-Za-z]+) (\d{1,2})(?:, (\d{4}))?(?:\s*-\s*(?:([A-Za-z]+) )?(\d{1,2}))?, (\d{4})$/.exec(
    text.trim()
  );
  if (!match) {
    return null;
  }
  const [, month, day, firstYear, lastMonth, lastDayOfRange, year] = match;
  const firstDay = isoDay(Number(firstYear ?? year), month, Number(day));
  const lastDay = lastDayOfRange ? isoDay(Number(year), lastMonth ?? month, Number(lastDayOfRange)) : firstDay;
  return firstDay && lastDay && firstDay <= lastDay ? { firstDay, lastDay } : null;
}

/** The ID of the row's TCG tournament: the link whose icon is the TCG one. */
function tcgTournamentId(row: string): string | null {
  let at = row.indexOf(TOURNAMENT_HREF);
  while (at >= 0) {
    const idStart = at + TOURNAMENT_HREF.length;
    const idEnd = row.indexOf('"', idStart);
    const linkEnd = row.indexOf('</a>', idEnd);
    if (idEnd < 0 || linkEnd < 0) {
      return null;
    }
    if (row.slice(idEnd, linkEnd).includes('pokemon-tcg')) {
      return row.slice(idStart, idEnd);
    }
    at = row.indexOf(TOURNAMENT_HREF, linkEnd);
  }
  return null;
}

/** `2027 Brisbane Pokémon Regional Championships` reads better without its season and brand. */
function displayName(raw: string): string {
  return raw
    .replace(/^\d{4}\s+/, '')
    .replace(/\bPok\S{1,8}mon\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

type RowRead = LiveEvent | 'skipped' | 'unreadable';

function readRow(row: string): RowRead {
  const link = EVENT_LINK_RE.exec(row);
  if (!link) {
    return 'skipped';
  }
  const title = decodeHtmlEntities(link[2]).trim();
  const kind = KINDS.find(([pattern]) => pattern.test(title))?.[1];
  const rk9Id = tcgTournamentId(row);
  if (!kind || !rk9Id) {
    return 'skipped';
  }
  const days = parseRk9Dates(decodeHtmlEntities(FIRST_CELL_RE.exec(row)?.[1] ?? ''));
  const name = displayName(title);
  if (!days || !name) {
    return 'unreadable';
  }
  return { slug: link[1], name, kind, rk9Id, pod: MASTERS_POD, ...days };
}

export function parseRk9Events(html: string): Rk9EventsParse {
  const result: Rk9EventsParse = { events: [], rowsSeen: 0, rowsUnreadable: 0 };
  for (const chunk of html.split(/<tr\b[^>]*>/i).slice(1)) {
    const row = chunk.split('</tr>', 1)[0];
    if (!row.includes('/event/pokemon-')) {
      continue;
    }
    result.rowsSeen += 1;
    const read = readRow(row);
    if (read === 'unreadable') {
      result.rowsUnreadable += 1;
    } else if (read !== 'skipped') {
      result.events.push(read);
    }
  }
  result.events.sort((a, b) => a.firstDay.localeCompare(b.firstDay) || a.slug.localeCompare(b.slug));
  return result;
}

/** The list is always long, so no event rows, or an unreadable one, means the markup moved. */
export function detectEventsBreakage(result: Rk9EventsParse): string | undefined {
  if (result.rowsSeen === 0) {
    return 'RK9 event list has no event rows';
  }
  if (result.rowsUnreadable > 0) {
    return `RK9 event list: ${result.rowsUnreadable} of ${result.rowsSeen} event rows unreadable`;
  }
  return undefined;
}
