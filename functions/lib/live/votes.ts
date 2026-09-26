/**
 * Deck-report votes in D1. Every query is bounded by the primary key or the
 * voter index, so a vote costs a handful of row reads however busy the event.
 *
 * The database has one location and a function runs wherever the reporter is,
 * so each statement is a round trip that can cost a quarter of a second from
 * the far side of the world. A batch's writes and recounts therefore go as one
 * `batch`, one round trip however many seats a run names.
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
  /** Runs the statements in order, in one transaction and one round trip. */
  batch: (statements: D1Statement[]) => Promise<{ results?: unknown[] }[]>;
}

/** What one device has already reported at an event. */
export interface VoterLoad {
  /** Seats this device has a report on. */
  seats: number;
  /** How many of the seats asked about are among them, so a change is not a new seat. */
  held: number;
}

export interface VoteStore {
  /** The device's load at the event, and how much of it the given seats already are. */
  loadOf: (slug: string, voter: string, seats: readonly string[]) => Promise<VoterLoad>;
  /**
   * Records every report, each replacing this device's earlier one for its seat
   * and a null archetype removing it, then recounts each seat, in report order.
   */
  settle: (reports: readonly DeckReport[], at: number) => Promise<ArchetypeTally[][]>;
}

function recordStatement(db: D1Like, report: DeckReport, at: number): D1Statement {
  if (report.archetype === null) {
    return db
      .prepare('DELETE FROM votes WHERE slug = ? AND seat = ? AND voter = ?')
      .bind(report.slug, report.seat, report.voter);
  }
  return db
    .prepare(
      'INSERT INTO votes (slug, seat, voter, archetype, at) VALUES (?, ?, ?, ?, ?) ' +
        'ON CONFLICT (slug, seat, voter) DO UPDATE SET archetype = excluded.archetype, at = excluded.at'
    )
    .bind(report.slug, report.seat, report.voter, report.archetype, at);
}

function tallyStatement(db: D1Like, report: DeckReport): D1Statement {
  return db
    .prepare('SELECT archetype, COUNT(*) AS votes FROM votes WHERE slug = ? AND seat = ? GROUP BY archetype')
    .bind(report.slug, report.seat);
}

export function createVoteStore(db: D1Like): VoteStore {
  return {
    async loadOf(slug, voter, seats) {
      const row = await db
        .prepare(
          `SELECT COUNT(*) AS n, SUM(CASE WHEN seat IN (${seats.map(() => '?').join(', ')}) THEN 1 ELSE 0 END) AS mine ` +
            'FROM votes WHERE slug = ? AND voter = ?'
        )
        .bind(...seats, slug, voter)
        .first<{ n: number; mine: number | null }>();
      return { seats: row?.n ?? 0, held: row?.mine ?? 0 };
    },
    async settle(reports, at) {
      const results = await db.batch([
        ...reports.map(report => recordStatement(db, report, at)),
        ...reports.map(report => tallyStatement(db, report))
      ]);
      return results.slice(reports.length).map(result => (result.results ?? []) as ArchetypeTally[]);
    }
  };
}
