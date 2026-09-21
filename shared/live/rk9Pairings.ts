/**
 * Parser for one RK9 pairings round fragment
 * (`rk9.gg/pairings/{id}?pod={pod}&rnd={round}`).
 *
 * A pure function over a string, like the Limitless upcoming parser, so the
 * brittle part is testable against captured markup. A round that has not been
 * posted yet is an empty body, which parses to zero rows and zero matches; rows
 * that are present but unreadable are counted so a markup change cannot pass as
 * an empty round.
 *
 * One match row:
 *
 *   <div class="row row-cols-3 match no-gutter complete">
 *     <div id="cell-2-3-1204-1" class="col-5 text-center player player1 loser">
 *       <span class="name">Anthony<br> Ribeiro [BR]<br></span> (2-1-0) 6 pts <br></div>
 *     <div id="cell-2-3-1204-3" class="col-2 text-center"> Table<br>
 *       <span class="tablenumber"> 1204 </span><br></div>
 *     <div id="cell-2-3-1204-2" class="col-5 text-center player player2 winner">...</div>
 *   </div>
 *
 * Top cut rows are the same markup without the points: a seat there carries
 * its Swiss record, frozen, and nothing else, which is also how a top cut round
 * is told from a Swiss one.
 *
 * The cell id carries the table number and the seat (1, 2, or 3 for the middle
 * column). A bye or an unpaired loss is table 0 with an empty second seat. While
 * a result awaits staff confirmation the reporting side carries a
 * "win submitted" badge, or the middle column a "tie submitted" one.
 *
 * Isomorphic — no environment-specific dependencies.
 * @module shared/live/rk9Pairings
 */

import { decodeHtmlEntities } from '../api/upcomingParser';
import type { LiveMatch, LiveResult, LiveRoundParse, LiveSeat, LiveSubmitted } from './types';

/**
 * Opening tag of a match row; the capture is its class list. Classes are matched
 * as whole tokens, since `\b` would also accept `match-foo` or `player-name`.
 */
const ROW_OPEN_RE = /<div\b[^>]*\bclass="((?:[^"]*\s)?match(?:\s[^"]*)?)"[^>]*>/gi;
const CELL_RE = /<div\b([^>]*)>([\s\S]*?)<\/div>/gi;
const CELL_ID_RE = /\bid="cell-\d+-\d+-(\d+)-([123])"/i;
const CLASS_RE = /\bclass="([^"]*)"/i;
const NAME_RE = /<span\b[^>]*\bclass="(?:[^"]*\s)?name(?:\s[^"]*)?"[^>]*>([\s\S]*?)<\/span>/i;
const RECORD_RE = /\((\d+)-(\d+)-(\d+)\)(?:\s*(\d+)\s*pts)?/i;
const COUNTRY_RE = /\s*\[([A-Za-z]{2,3})\]$/;
const SUBMITTED_RE = /\b(win|tie) submitted\b/i;
/** A whole fragment closes its last cell and its last row. */
const FRAGMENT_END_RE = /<\/div>\s*<\/div>\s*$/i;

const RESULT_BY_CLASS: Record<string, LiveResult> = { winner: 'win', loser: 'loss', tie: 'tie' };

interface Cell {
  table: number;
  seat: 1 | 2 | 3;
  classes: string[];
  body: string;
}

function readCells(row: string): Cell[] {
  const cells: Cell[] = [];
  for (const [, attrs, body] of row.matchAll(CELL_RE)) {
    const id = CELL_ID_RE.exec(attrs);
    if (id) {
      const classes = (CLASS_RE.exec(attrs)?.[1] ?? '').split(/\s+/).filter(Boolean);
      cells.push({ table: Number(id[1]), seat: Number(id[2]) as Cell['seat'], classes, body });
    }
  }
  return cells;
}

function readName(body: string): { name: string; country: string } | null {
  const raw = NAME_RE.exec(body)?.[1];
  if (raw === undefined) {
    return null;
  }
  const text = decodeHtmlEntities(raw.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
  const country = COUNTRY_RE.exec(text)?.[1].toUpperCase() ?? '';
  const name = text.replace(COUNTRY_RE, '');
  return name ? { name, country } : null;
}

interface ReadSeat {
  seat: LiveSeat;
  /** Whether RK9 printed the points, which it does in every Swiss round and no top cut one. */
  scored: boolean;
}

function readSeat(cell: Cell): ReadSeat | null {
  const identity = readName(cell.body);
  const record = RECORD_RE.exec(cell.body);
  if (!identity || !record) {
    return null;
  }
  const [wins, losses, ties] = record.slice(1, 4).map(Number);
  const scored = record[4] !== undefined;
  const resultClass = cell.classes.find(token => token in RESULT_BY_CLASS);
  const seat: LiveSeat = {
    ...identity,
    wins,
    losses,
    ties,
    // Unprinted in top cut, where it is still the Swiss record's worth.
    points: scored ? Number(record[4]) : wins * 3 + ties,
    ...(resultClass ? { result: RESULT_BY_CLASS[resultClass] } : {}),
    ...(cell.classes.includes('dropped') ? { dropped: true as const } : {})
  };
  return { seat, scored };
}

function readSubmitted(cells: Cell[]): LiveSubmitted | undefined {
  for (const cell of cells) {
    const kind = SUBMITTED_RE.exec(cell.body)?.[1].toLowerCase();
    if (kind === 'tie') {
      return 'tie';
    }
    if (kind === 'win' && cell.seat !== 3) {
      return cell.seat === 1 ? 'p1' : 'p2';
    }
  }
  return undefined;
}

/** A confirmed one-seat row is a bye when won; otherwise the player was given a loss. */
function settleSolo(seat: LiveSeat, complete: boolean): LiveSeat {
  return complete && !seat.result ? { ...seat, result: 'loss' } : seat;
}

interface ReadMatch {
  match: LiveMatch;
  scored: boolean;
}

function readMatch(rowClasses: string, row: string): ReadMatch | null {
  const cells = readCells(row);
  const players = cells.filter(cell => cell.seat !== 3 && cell.body.trim() !== '');
  const read = players.map(readSeat).filter((seat): seat is ReadSeat => seat !== null);
  if (read.length === 0 || read.length !== players.length) {
    return null;
  }
  const seats = read.map(entry => entry.seat);
  const complete = rowClasses.split(/\s+/).includes('complete');
  const submitted = complete ? undefined : readSubmitted(cells);
  return {
    match: {
      table: cells[0].table,
      seats: seats.length === 1 ? [settleSolo(seats[0], complete)] : seats,
      complete,
      ...(submitted ? { submitted } : {})
    },
    scored: read.some(entry => entry.scored)
  };
}

export function parseRk9Round(html: string): LiveRoundParse {
  const opens = [...html.matchAll(ROW_OPEN_RE)];
  const matches: LiveMatch[] = [];
  let scored = false;
  opens.forEach((open, i) => {
    const row = html.slice(open.index + open[0].length, opens[i + 1]?.index ?? html.length);
    const read = readMatch(open[1], row);
    if (read) {
      matches.push(read.match);
      scored ||= read.scored;
    }
  });
  return {
    matches,
    rowsSeen: opens.length,
    rowsSkipped: opens.length - matches.length,
    truncated: opens.length > 0 && !FRAGMENT_END_RE.test(html),
    topCut: matches.length > 0 && !scored
  };
}

/**
 * Same contract as the upcoming parser's check: rows were present but too few
 * were readable, so the markup has probably changed. An empty body is a round
 * that is not posted yet, not breakage. A body cut off mid-transfer would
 * otherwise read as a smaller round, and could pass for a finished one.
 */
export function detectRoundBreakage(result: LiveRoundParse): string | undefined {
  if (result.truncated) {
    return `RK9 round body cut short after ${result.rowsSeen} match rows`;
  }
  if (result.rowsSeen > 0 && result.rowsSkipped > result.rowsSeen / 10) {
    return `RK9 round markup changed: ${result.rowsSkipped} of ${result.rowsSeen} match rows unreadable`;
  }
  return undefined;
}
