/**
 * The comparison side of the Rising graphic.
 *
 * Rising measures a tournament against the recent field rather than one prior
 * event: the last three weekends that had any event, pooled by deck count. A
 * single comparison event is noisy, and picking which one is a judgment call
 * the graphic should not depend on.
 * @module src/pages/socialGraphics/baseline
 */

import type { EventField } from './eventField';

/** How many event weekends the baseline pools. */
export const BASELINE_WEEKENDS = 3;

/** Events older than this, relative to the graphic's event, never count. */
export const BASELINE_MAX_DAYS = 60;

const DAY_MS = 86_400_000;

/** The UTC timestamp of a dated tournament key, or null for undated ones. */
export function tournamentDate(key: string): number | null {
  const m = key.match(/^(\d{4})-(\d{2})-(\d{2}),/);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

/** The Sunday on or after a date, so a Friday-to-Sunday event is one weekend. */
function weekendOf(date: number): number {
  const day = new Date(date).getUTCDay();
  return date + ((7 - day) % 7) * DAY_MS;
}

/**
 * The tournaments the baseline pools: every event from the last
 * {@link BASELINE_WEEKENDS} weekends before the selected one's, none older than
 * {@link BASELINE_MAX_DAYS} days.
 * @param list - Tournament keys, any order
 * @param selected - The graphic's tournament key
 * @param now - Anchor for undated selections such as the online window
 * @returns Comparison keys, most recent first
 */
export function baselineTournaments(list: readonly string[], selected: string, now: number = Date.now()): string[] {
  const anchor = tournamentDate(selected) ?? now;
  const cutoff = anchor - BASELINE_MAX_DAYS * DAY_MS;
  const ownWeekend = weekendOf(anchor);
  const dated = list
    .map(key => ({ key, date: tournamentDate(key) }))
    .filter((t): t is { key: string; date: number } => t.date !== null && t.date >= cutoff)
    .filter(t => weekendOf(t.date) < ownWeekend)
    .sort((a, b) => b.date - a.date);
  const weekends = [...new Set(dated.map(t => weekendOf(t.date)))].slice(0, BASELINE_WEEKENDS);
  return dated.filter(t => weekends.includes(weekendOf(t.date))).map(t => t.key);
}

/** A card's pooled play across the baseline events where it was legal. */
export interface BaselineRate {
  found: number;
  total: number;
}

/**
 * Pool a card's play across the baseline, weighted by each event's decks.
 *
 * An event where not one card from the card's set was played predates the
 * set, so it is left out entirely rather than counted as a zero: a card that
 * just released is measured only against the events it was legal at.
 * @param fields - The baseline events
 * @param uid - The card's canonical UID
 * @param set - The card's set code
 * @returns Pooled counts, or null when no baseline event had the card legal
 */
export function baselineRate(fields: readonly EventField[], uid: string, set: string): BaselineRate | null {
  const legal = fields.filter(f => !set || f.sets.has(set.toUpperCase()));
  const total = legal.reduce((sum, f) => sum + f.deckTotal, 0);
  if (total <= 0) {
    return null;
  }
  return { found: legal.reduce((sum, f) => sum + (f.cards.get(uid)?.found ?? 0), 0), total };
}
