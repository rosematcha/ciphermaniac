/**
 * Resolve a format's window to concrete dates.
 * @module shared/formats/window
 */

import { ENERGY_SETS, PROMO_SETS, SET_CATALOG } from '../data/canonicalPrint';
import type { FormatWindow } from './registry';

const DAY_MS = 86_400_000;
/**
 * A set turns tournament-legal on the second Friday after release, so release
 * is legality minus two weeks. Online play (Limitless's "set" buckets) starts
 * at release, which is why the window opens there.
 */
const LEGALITY_LAG_DAYS = 14;

/**
 * Release dates of the Standard release groups legal by `today`, newest first.
 * Promo and energy sets share a group's date and never open one of their own.
 * @param today - ISO date
 */
export function releaseGroups(today: string): string[] {
  const dates = new Set<string>();
  for (const entry of SET_CATALOG) {
    if (entry.legalFrom && entry.legalFrom <= today && !PROMO_SETS.has(entry.code) && !ENERGY_SETS.has(entry.code)) {
      dates.add(entry.legalFrom);
    }
  }
  return [...dates]
    .sort()
    .reverse()
    .map(legalFrom => new Date(Date.parse(`${legalFrom}T00:00:00Z`) - LEGALITY_LAG_DAYS * DAY_MS).toISOString());
}

function startOf(window: FormatWindow, now: Date): number {
  if (window.kind === 'all') {
    return Date.parse(`${window.since}T00:00:00Z`);
  }
  const groups = releaseGroups(now.toISOString().slice(0, 10));
  const oldest = groups[Math.min(window.kind === 'sets' ? window.count : 0, groups.length) - 1];
  if (!oldest) {
    throw new Error('No legal release groups in the set catalog');
  }
  return Date.parse(oldest);
}

/**
 * The window's length in whole UTC days, for `utcDayWindow`: windows end at
 * the start of the current UTC day like the Standard online meta's.
 * @param window - The format's window
 * @param now - The run's clock
 */
export function windowDays(window: FormatWindow, now: Date): number {
  if (window.kind === 'days') {
    return window.days;
  }
  const today = Math.floor(now.getTime() / DAY_MS) * DAY_MS;
  return Math.max(1, Math.ceil((today - startOf(window, now)) / DAY_MS));
}
