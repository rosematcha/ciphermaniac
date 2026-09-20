/**
 * Deck-report votes in D1. Every query is bounded by the primary key or the
 * voter index, so a vote costs a handful of row reads however busy the event.
 */

import type { ArchetypeTally, DeckReport } from '../../../shared/live/reports.js';

interface D1Statement {
  bind: (...values: unknown[]) => D1Statement;
  first: <T>() => Promise<T | null>;
  all: <T>() => Promise<{ results: T[] }>;
  run: () => Promise<unknown>;
}

export interface D1Like {
  prepare: (sql: string) => D1Statement;
}

/** What one device has already reported at an event. */
export interface VoterLoad {
  /** Seats this device has a report on. */
  seats: number;
  /** Whether this seat is one of them, so a change or a retraction is not a new seat. */
  reported: boolean;
}

export interface VoteStore {
  loadOf: (slug: string, voter: string, seat: string) => Promise<VoterLoad>;
  /** Records the report, replacing this device's earlier one for the seat; a null archetype removes it. */
  record: (report: DeckReport, at: number) => Promise<void>;
  tally: (slug: string, seat: string) => Promise<ArchetypeTally[]>;
}

export function createVoteStore(db: D1Like): VoteStore {
  return {
    async loadOf(slug, voter, seat) {
      const row = await db
        .prepare(
          'SELECT COUNT(*) AS n, SUM(CASE WHEN seat = ? THEN 1 ELSE 0 END) AS mine ' +
            'FROM votes WHERE slug = ? AND voter = ?'
        )
        .bind(seat, slug, voter)
        .first<{ n: number; mine: number | null }>();
      return { seats: row?.n ?? 0, reported: (row?.mine ?? 0) > 0 };
    },
    async record(report, at) {
      if (report.archetype === null) {
        await db
          .prepare('DELETE FROM votes WHERE slug = ? AND seat = ? AND voter = ?')
          .bind(report.slug, report.seat, report.voter)
          .run();
        return;
      }
      await db
        .prepare(
          'INSERT INTO votes (slug, seat, voter, archetype, at) VALUES (?, ?, ?, ?, ?) ' +
            'ON CONFLICT (slug, seat, voter) DO UPDATE SET archetype = excluded.archetype, at = excluded.at'
        )
        .bind(report.slug, report.seat, report.voter, report.archetype, at)
        .run();
    },
    async tally(slug, seat) {
      const { results } = await db
        .prepare('SELECT archetype, COUNT(*) AS votes FROM votes WHERE slug = ? AND seat = ? GROUP BY archetype')
        .bind(slug, seat)
        .all<ArchetypeTally>();
      return results;
    }
  };
}
