/**
 * Deck reports: reading an event's published votes and sending new ones. Kept
 * apart from `./live` because only the live pages use them, and that module
 * ships with the banner on every page.
 * @module src/lib/data/liveReports
 */

import { liveClient } from './live';
import { type DeckReport, type LiveReports, liveReportsKey } from '../../../shared/live/reports';

/** Null until someone has reported a deck at the event. */
export function fetchLiveReports(slug: string): Promise<LiveReports | null> {
  return liveClient.fetchJsonOptional<LiveReports>(`/${liveReportsKey(slug)}`);
}

export interface DeckReportAnswer {
  /** The archetype each seat now shows, by seat key. */
  archetypes: Record<string, string | null>;
  /** When the published file that shows them was written; null if none has been. */
  updatedAt: string | null;
}

/**
 * Reports one or more seats' decks in a single request, and answers with the
 * archetype now shown for each seat, which may not be the one just reported:
 * a seat only shows the archetype more than half its reports agree on.
 */
export async function submitDeckReports(reports: readonly DeckReport[]): Promise<DeckReportAnswer> {
  const response = await fetch('/api/live/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reports })
  });
  if (!response.ok) {
    throw new Error(`Report failed (${response.status})`);
  }
  return (await response.json()) as DeckReportAnswer;
}
