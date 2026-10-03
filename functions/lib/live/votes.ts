/**
 * Deck-report votes in D1. Every query is bounded by the primary key or the
 * voter index, so a vote costs a handful of row reads however busy the event.
 *
 * The database has one location and a function runs wherever the reporter is,
 * so each statement is a round trip that can cost a quarter of a second from
 * the far side of the world. A batch's writes and recounts therefore go as one
 * `batch`, one round trip however many seats a run names.
 */

import { type ArchetypeTally, type DeckReport, leadingArchetype } from '../../../shared/live/reports.js';
import type { D1Like, D1Statement } from '../types.js';

/** What one device has already reported at an event. */
export interface VoterLoad {
  /** Seats this device has a report on. */
  seats: number;
  /** How many of the seats asked about are among them, so a change is not a new seat. */
  held: number;
}

export interface DirtySeat {
  seat: string;
  revision: number;
  archetype: string | null;
}

export interface VoteStore {
  pending: () => Promise<string[]>;
  markAttempted: (slug: string, at: number) => Promise<void>;
  dirty: (slug: string) => Promise<DirtySeat[]>;
  acknowledge: (slug: string, seats: readonly DirtySeat[]) => Promise<void>;
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
    async pending() {
      const { results } = await db
        .prepare(
          // Include clean seats so new seats cannot reset a repeatedly attempted event's priority.
          'SELECT slug FROM live_report_outbox GROUP BY slug HAVING MAX(revision > published_revision) = 1 ' +
            'ORDER BY MAX(last_attempted), slug LIMIT 10'
        )
        .all<{ slug: string }>();
      return results.map(row => row.slug);
    },
    async markAttempted(slug, at) {
      await db
        .prepare('UPDATE live_report_outbox SET last_attempted = MAX(last_attempted + 1, ?) WHERE slug = ?')
        .bind(at, slug)
        .run();
    },
    async dirty(slug) {
      const { results } = await db
        .prepare(
          'SELECT o.seat, o.revision, v.archetype, COUNT(v.voter) AS votes FROM live_report_outbox o ' +
            'LEFT JOIN votes v ON v.slug = o.slug AND v.seat = o.seat ' +
            'WHERE o.slug = ? AND o.revision > o.published_revision GROUP BY o.seat, o.revision, v.archetype'
        )
        .bind(slug)
        .all<{ seat: string; revision: number; archetype: string | null; votes: number }>();
      const seats = new Map<string, { revision: number; tallies: ArchetypeTally[] }>();
      for (const row of results) {
        const seat = seats.get(row.seat) ?? { revision: row.revision, tallies: [] };
        if (row.archetype !== null) {
          seat.tallies.push({ archetype: row.archetype, votes: row.votes });
        }
        seats.set(row.seat, seat);
      }
      return [...seats].map(([seat, row]) => ({
        seat,
        revision: row.revision,
        archetype: leadingArchetype(row.tallies)
      }));
    },
    async acknowledge(slug, seats) {
      if (seats.length === 0) {
        return;
      }
      await db
        .prepare(
          'UPDATE live_report_outbox SET published_revision = revision WHERE slug = ? AND (seat, revision) IN ' +
            "(SELECT json_extract(value, '$.seat'), json_extract(value, '$.revision') FROM json_each(?))"
        )
        .bind(slug, JSON.stringify(seats.map(({ seat, revision }) => ({ seat, revision }))))
        .run();
    },
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
        ...reports.map(report =>
          db
            .prepare(
              'INSERT INTO live_report_outbox (slug, seat, revision, published_revision) VALUES (?, ?, 1, 0) ' +
                'ON CONFLICT (slug, seat) DO UPDATE SET revision = revision + 1'
            )
            .bind(report.slug, report.seat)
        ),
        ...reports.map(report => tallyStatement(db, report))
      ]);
      return results.slice(reports.length * 2).map(result => (result.results ?? []) as ArchetypeTally[]);
    }
  };
}
