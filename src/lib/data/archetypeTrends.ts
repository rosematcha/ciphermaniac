/**
 * The shape check for one archetype's `trends.json` from a rolling scope: its
 * lists per day, each card's lists per day, and the online matchups map.
 * `fetchArchetypeTrends` (./matchups) loads this module beside the download, so the
 * check stays out of the first page load.
 * @module src/lib/data/archetypeTrends
 */

import {
  checkFields,
  type FieldSpec,
  isFiniteInRange,
  isIntegerAtLeast,
  isNonEmptyString,
  isRecord,
  orNull,
  required
} from '../../../shared/data/validate';

/**
 * One opponent's head-to-head record as stored in the online meta. Unlike the
 * majors file, `winRate` here is `wins / total` (ties excluded from the numerator,
 * included in the denominator) — recompute as `(wins + ties/2)/total` if you want
 * the ties-as-half convention the majors file uses.
 */
export interface OnlineMatchupRecord {
  opponent: string;
  wins: number;
  losses: number;
  ties: number;
  total: number;
  winRate: number;
}

/** One printing's lists per day, aligned with {@link ArchetypeTrends.days}. */
export interface TrendCard {
  name: string;
  set: string;
  number: string;
  lists: number[];
}

export interface ArchetypeTrends {
  /** Days with at least one list, oldest first, and the archetype's lists that day; null when the file has none or they can't be read. */
  days: { date: string; lists: number }[] | null;
  /** The last day the scope covers, YYYY-MM-DD; null when the file doesn't say. */
  windowEnd: string | null;
  /** Every printing with a set and number and a readable timeline; a card without them is left out. */
  cards: TrendCard[];
  /** Opponent label → record, the readable ones; null when the file has none. */
  matchups: Record<string, OnlineMatchupRecord> | null;
}

const isDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const count = isIntegerAtLeast(0);
const DAY: FieldSpec = {
  date: required(isDate, 'a YYYY-MM-DD date'),
  totals: required(value => isRecord(value) && count(value.all), 'totals with an `all` count')
};
const CARD: FieldSpec = {
  name: required(isNonEmptyString, 'a name'),
  set: orNull(isNonEmptyString, 'a set code'),
  number: orNull(isNonEmptyString, 'a card number'),
  timeline: required(isRecord, 'an object')
};
const tally = isFiniteInRange(0, Number.POSITIVE_INFINITY);
const MATCHUP: FieldSpec = {
  opponent: required(isNonEmptyString, 'a label'),
  wins: required(tally, 'a count'),
  losses: required(tally, 'a count'),
  ties: required(tally, 'a count'),
  total: required(tally, 'a count'),
  winRate: required(tally, 'a rate')
};

/** The fields that fail `spec`, with `path`; none when the record passes. */
function problems(value: unknown, path: string, spec: FieldSpec): string[] {
  const errors: string[] = [];
  checkFields(isRecord(value) ? value : {}, path, spec, errors);
  return errors;
}

/** A card's lists on one day: 0 when absent, null when the entry is malformed. */
function listsOn(entry: unknown): number | null {
  const all = isRecord(entry) ? entry.all : entry;
  if (all === undefined) {
    return 0;
  }
  return isRecord(all) && count(all.count) ? (all.count as number) : null;
}

/** The days, or null when any is unreadable: every card timeline is indexed by them. */
function parseDays(value: unknown, errors: string[]): ArchetypeTrends['days'] {
  const found = Array.isArray(value)
    ? value.flatMap((day, index) => problems(day, `days[${index}]`, DAY))
    : ['days: an array'];
  errors.push(...found);
  return found.length
    ? null
    : (value as { date: string; totals: { all: number } }[]).map(day => ({ date: day.date, lists: day.totals.all }));
}

function parseCard(id: string, value: unknown, dayCount: number, errors: string[]): TrendCard | null {
  const found = problems(value, `cards.${id}`, CARD);
  const card = value as { name: string; set: string | null; number: string | null; timeline: Record<string, unknown> };
  const lists = found.length ? [] : Array.from({ length: dayCount }, (_, day) => listsOn(card.timeline[day]));
  if (lists.includes(null)) {
    found.push(`cards.${id}.timeline: an \`all\` count per day`);
  }
  errors.push(...found);
  // A card without a printing can't be linked or told apart, so it is skipped.
  return found.length || !card.set || !card.number
    ? null
    : { name: card.name, set: card.set, number: card.number, lists: lists as number[] };
}

function parseMatchups(value: unknown, errors: string[]): ArchetypeTrends['matchups'] {
  if (value === undefined || value === null) {
    return null;
  }
  const entries = Object.entries(isRecord(value) ? value : {});
  const found = entries.map(([label, record]) => problems(record, `matchups.${label}`, MATCHUP));
  errors.push(...(isRecord(value) ? found.flat() : ['matchups: an object']));
  return Object.fromEntries(entries.filter((_, index) => !found[index].length)) as Record<string, OnlineMatchupRecord>;
}

/**
 * Check a raw `trends.json` and keep the parts that read cleanly. Each part
 * stands alone, so an older file without days, or one bad card, still leaves
 * the matchups for the Matchups tab and the win rate.
 * @param raw - The parsed JSON body
 * @returns The readable parts, with the problems logged; null when the body isn't an object
 */
export function parseArchetypeTrends(raw: unknown): ArchetypeTrends | null {
  if (!isRecord(raw)) {
    console.warn('[archetypeTrends] trends.json: an object');
    return null;
  }
  const errors: string[] = [];
  const days = parseDays(raw.days, errors);
  const cards = Object.entries(days && isRecord(raw.cards) ? raw.cards : {})
    .map(([id, card]) => parseCard(id, card, days?.length ?? 0, errors))
    .filter(card => card !== null);
  const windowEnd = isRecord(raw.meta) && isDate(raw.meta.windowEnd) ? raw.meta.windowEnd : null;
  const matchups = parseMatchups(raw.matchups, errors);
  if (errors.length) {
    console.warn(`[archetypeTrends] ${errors.slice(0, 5).join('; ')}`);
  }
  return { days, windowEnd, cards, matchups };
}
