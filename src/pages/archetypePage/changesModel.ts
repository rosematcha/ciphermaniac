/**
 * The archetype page's Changes tab: each card's share of this archetype's
 * lists this week against last, from the archetype's `trends.json`.
 *
 * Small samples wobble, so a change is only "clear" when a two-proportion test
 * at 95% says so, and its 95% range is drawn either way. An evolution line
 * that moved together is one row under its top stage, so the table reads one
 * row per decision a player made.
 * @module src/pages/archetypePage/changesModel
 */

import type { ArchetypeTrends, TrendCard } from '../../lib/data/archetypeTrends';
import { deckSection } from '../../../shared/data/cardOrder';
import type { CardItem } from '../../types';
import { signedPercent } from '../trendsPage/weekly';

/** Both weeks need this many lists before any change is shown. */
export const MIN_WEEK_LISTS = 20;
/** Changes smaller than this many points are left out. */
const MIN_CHANGE = 2;
/** Slack for a change of exactly MIN_CHANGE that floating point puts a hair under it (1% → 3% is 1.9999999999999998). */
const EPSILON = 1e-9;
/** Below this many expected lists in any cell, the normal approximation is unreliable and Fisher's exact test decides. */
const MIN_EXPECTED = 5;
/** A pre-evolution folds into its stage above when their changes are this many points apart or closer. */
const SAME_MOVE = 3;
const Z_95 = 1.96;
const DAY_MS = 24 * 60 * 60 * 1000;

type Day = NonNullable<ArchetypeTrends['days']>[number];

export interface Week {
  /** First and last day, YYYY-MM-DD. */
  start: string;
  end: string;
  lists: number;
}

/** One printing's share of lists in each week, in percent. */
export interface Change {
  name: string;
  set: string;
  number: string;
  /** The report's category path for the card; null when the report doesn't list it. */
  category: string | null;
  before: number;
  after: number;
  /** `after - before`, in points, with its 95% range. */
  delta: number;
  low: number;
  high: number;
  /** The test says the change is more than week-to-week wobble. */
  clear: boolean;
  /** Pre-evolutions that moved with it, lowest stage last. */
  line: string[];
}

export interface WeeklyChanges {
  thisWeek: Week;
  lastWeek: Week;
  /** Biggest rise first, biggest fall last; empty when a week has too few lists. */
  rows: Change[];
}

/** YYYY-MM-DD shifted by whole days. */
function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Sum the entries whose day falls inside a week. */
function weekSum(values: number[], dates: string[], week: Week): number {
  return values.reduce((sum, value, i) => (dates[i] >= week.start && dates[i] <= week.end ? sum + value : sum), 0);
}

/** ln(0!) … ln(n!). */
function logFactorials(n: number): number[] {
  const out = [0];
  for (let i = 1; i <= n; i++) {
    out.push(out[i - 1] + Math.log(i));
  }
  return out;
}

/**
 * Two-sided Fisher exact p for `k1` of `n1` lists against `k0` of `n0`: the
 * chance, with the card's lists fixed, of a split at most as likely as this one.
 */
function fisherExactP(k1: number, n1: number, k0: number, n0: number): number {
  const n = n1 + n0;
  const k = k1 + k0;
  const lf = logFactorials(n);
  const logP = (x: number) =>
    lf[k] - lf[x] - lf[k - x] + lf[n - k] - lf[n1 - x] - lf[n - k - n1 + x] - lf[n] + lf[n1] + lf[n0];
  const observed = logP(k1);
  let p = 0;
  for (let x = Math.max(0, n1 + k - n); x <= Math.min(k, n1); x++) {
    const lp = logP(x);
    p += lp <= observed + 1e-7 ? Math.exp(lp) : 0;
  }
  return Math.min(1, p);
}

/** Whether some cell of the 2×2 table expects under five lists, too few for the normal approximation. */
function sparse(k: number, n1: number, n0: number): boolean {
  const n = n1 + n0;
  return (Math.min(n1, n0) * Math.min(k, n - k)) / n < MIN_EXPECTED;
}

/**
 * Two-proportion test of `k1/n1` against `k0/n0`, with the change's 95% range
 * drawn from the pooled standard error and stopped at 100 points either way,
 * the most a share can change. With enough lists a range that crosses zero is
 * exactly a change the test can't call; sparse counts are decided by Fisher's
 * exact test instead, which the range doesn't follow.
 */
function compareShares(k1: number, n1: number, k0: number, n0: number) {
  const after = k1 / n1;
  const before = k0 / n0;
  const pooled = (k1 + k0) / (n1 + n0);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n0));
  const delta = after - before;
  const half = Z_95 * se;
  return {
    before: 100 * before,
    after: 100 * after,
    delta: 100 * delta,
    low: 100 * Math.max(delta - half, -1),
    high: 100 * Math.min(delta + half, 1),
    clear: se > 0 && (sparse(k1 + k0, n1, n0) ? fisherExactP(k1, n1, k0, n0) <= 0.05 : Math.abs(delta) / se >= Z_95)
  };
}

/** Each card's pre-evolution, by name, from the report's deck-ordered items. */
function parents(items: readonly CardItem[]): Map<string, string> {
  return new Map(items.filter(item => item.evolvesFrom).map(item => [item.name, item.evolvesFrom!]));
}

/** Steps from a card down its line to the lowest stage the list plays. */
function depth(name: string, parentOf: Map<string, string>): number {
  let steps = 0;
  for (let at = parentOf.get(name); at && steps < 8; at = parentOf.get(at)) {
    steps += 1;
  }
  return steps;
}

/**
 * Fold each pre-evolution into the stage above it when both moved the same
 * way by about as much: one row reads "Crustle, with Dwebble". Top stages go
 * first so a whole line folds into its highest member. A clear change never
 * folds under one that could be noise.
 */
function foldLines(rows: Change[], parentOf: Map<string, string>): Change[] {
  const folded = new Set<Change>();
  const sameMove = (top: Change, row: Change) =>
    Math.sign(row.delta) === Math.sign(top.delta) &&
    Math.abs(row.delta - top.delta) <= SAME_MOVE &&
    (top.clear || !row.clear);
  const byDepth = [...rows].sort((a, b) => depth(b.name, parentOf) - depth(a.name, parentOf));
  for (const top of byDepth) {
    for (let parent = parentOf.get(top.name); parent && !folded.has(top); parent = parentOf.get(parent)) {
      const match = rows
        .filter(row => row !== top && !folded.has(row) && row.name === parent && sameMove(top, row))
        .sort((a, b) => Math.abs(a.delta - top.delta) - Math.abs(b.delta - top.delta))[0];
      if (!match) {
        break;
      }
      top.line.push(match.name);
      folded.add(match);
    }
  }
  return rows.filter(row => !folded.has(row));
}

/** Big enough to show: at least two points, and clear or a few points on a card a real share of lists play. */
function worthShowing(row: Change): boolean {
  return (
    Math.abs(row.delta) + EPSILON >= MIN_CHANGE &&
    (row.clear || (Math.abs(row.delta) >= 3 && Math.max(row.before, row.after) >= 5))
  );
}

/**
 * The two weeks ending on the scope's last day; a file that doesn't name it
 * ends on the archetype's last day with lists. A day without lists counts as
 * none, so an archetype that stopped appearing reads as an empty week.
 */
function weeks(trends: ArchetypeTrends, days: Day[]): { thisWeek: Week; lastWeek: Week } {
  const end = trends.windowEnd ?? days.at(-1)?.date ?? '1970-01-01';
  const dates = days.map(day => day.date);
  const lists = days.map(day => day.lists);
  const thisWeek = { start: shiftDate(end, -6), end, lists: 0 };
  const lastWeek = { start: shiftDate(end, -13), end: shiftDate(end, -7), lists: 0 };
  thisWeek.lists = weekSum(lists, dates, thisWeek);
  lastWeek.lists = weekSum(lists, dates, lastWeek);
  return { thisWeek, lastWeek };
}

/**
 * This week's card changes for one archetype.
 * @param trends - The archetype's trends
 * @param items - The archetype report's cards, for each card's category and evolution line
 * @returns Both weeks and the changes to list
 */
export function weeklyChanges(trends: ArchetypeTrends, items: readonly CardItem[]): WeeklyChanges {
  const days = trends.days ?? [];
  const { thisWeek, lastWeek } = weeks(trends, days);
  if (thisWeek.lists < MIN_WEEK_LISTS || lastWeek.lists < MIN_WEEK_LISTS) {
    return { thisWeek, lastWeek, rows: [] };
  }
  const dates = days.map(day => day.date);
  const itemFor = (card: TrendCard) =>
    items.find(item => item.set === card.set && String(item.number) === card.number) ??
    items.find(item => item.name === card.name);
  const changes = trends.cards
    .map(card => ({ card, item: itemFor(card) }))
    .map(({ card, item }): Change => ({
      name: card.name,
      set: card.set,
      number: card.number,
      category: item?.category ?? null,
      ...compareShares(
        weekSum(card.lists, dates, thisWeek),
        thisWeek.lists,
        weekSum(card.lists, dates, lastWeek),
        lastWeek.lists
      ),
      line: []
    }))
    .filter(
      row =>
        worthShowing(row) &&
        !(row.category && deckSection({ name: row.name, category: row.category }, null) === 'energyBasic')
    );
  // Decide what's shown first, so a fold only ever joins shown changes.
  const rows = foldLines(changes, parents(items)).sort((a, b) => b.delta - a.delta);
  return { thisWeek, lastWeek, rows };
}

/** A range end as a signed whole percent; one that rounds to zero is "0%", never "−0%". */
function rangeEnd(value: number): string {
  return Math.round(value) === 0 ? '0%' : signedPercent(value);
}

/** The 95% range in words, for the bar's tooltip and for screen readers. */
export function rangeText(row: Pick<Change, 'low' | 'high' | 'clear'>): string {
  return `95% range ${rangeEnd(row.low)} to ${rangeEnd(row.high)}${row.clear ? '' : ', could be noise'}`;
}
