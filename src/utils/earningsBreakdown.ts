/**
 * What an expanded earnings row shows.
 *
 * A row means different things under different lenses — a whole career, or one
 * season — so the expansion does too. Both shapes are derived here rather than
 * in the component, since the grouping and the "which money" question are the
 * parts worth testing.
 */
import type { EarningsEvent } from '../../shared/earningsTypes.js';
import type { EarningsBasis } from './earningsRanking';

export interface SeasonSummary {
  season: string;
  /** Every event played that season, not only the paying ones. */
  eventCount: number;
  /** Best finish of the season, or null when no placement was recorded. */
  bestPlace: number | null;
  /** Money earned that season under the active pay scale. */
  amount: number;
}

/** The money one finish contributed under the active pay scale. */
export function eventAmount(event: EarningsEvent, basis: EarningsBasis): number {
  return basis === 'adjusted' ? event.adjusted : event.cash;
}

/**
 * Career expansion: one line per season that earned something.
 *
 * Seasons with no money under the active basis are dropped — they contributed
 * nothing to the career total the row is showing — but the event count covers
 * every event played in the seasons that remain.
 */
export function summarizeSeasons(events: EarningsEvent[], basis: EarningsBasis): SeasonSummary[] {
  const bySeason = new Map<string, SeasonSummary>();
  for (const event of events) {
    const summary = bySeason.get(event.season) ?? {
      season: event.season,
      eventCount: 0,
      bestPlace: null,
      amount: 0
    };
    summary.eventCount += 1;
    summary.amount += eventAmount(event, basis);
    if (event.place != null && (summary.bestPlace == null || event.place < summary.bestPlace)) {
      summary.bestPlace = event.place;
    }
    bySeason.set(event.season, summary);
  }
  return [...bySeason.values()].filter(s => s.amount > 0).sort((a, b) => b.season.localeCompare(a.season));
}

/**
 * Season expansion: every finish that season, in the order Limitless lists
 * them (oldest first), including the ones that paid nothing — the placements
 * are the point, not just the payouts.
 */
export function eventsInSeason(events: EarningsEvent[], season: string): EarningsEvent[] {
  return events.filter(event => event.season === season);
}

const ORDINAL_SUFFIX: Record<number, string> = { 1: 'st', 2: 'nd', 3: 'rd' };

/** `1` reads as `1st`. The teens are all `th`, including 11th through 13th. */
export function ordinalPlace(place: number | null): string {
  if (place == null) {
    return '—';
  }
  const teens = place % 100;
  const suffix = teens >= 11 && teens <= 13 ? 'th' : (ORDINAL_SUFFIX[place % 10] ?? 'th');
  return `${place}${suffix}`;
}
