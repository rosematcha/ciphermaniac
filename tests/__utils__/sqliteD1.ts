/**
 * D1 for tests: the D1Like surface over Node's built-in SQLite, with the real
 * schema from config/d1 applied. The functions' SQL runs as written, so a
 * query D1 would reject fails here too.
 */

import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import type { D1Like, D1Statement } from '../../functions/lib/types.ts';

function statement(db: DatabaseSync, sql: string, args: unknown[] = []): D1Statement {
  const values = () => args.map(value => (value === undefined ? null : value)) as SQLInputValue[];
  return {
    bind: (...next: unknown[]) => statement(db, sql, next),
    first: <T>() => Promise.resolve((db.prepare(sql).get(...values()) ?? null) as T | null),
    all: <T>() => Promise.resolve({ results: db.prepare(sql).all(...values()) as T[] }),
    run: () => {
      const result = db.prepare(sql).run(...values());
      return Promise.resolve({ success: true, meta: { changes: Number(result.changes) } });
    }
  };
}

/** A fresh in-memory database with `schema` (a file under config/d1) applied. */
export function sqliteD1(schema: string): D1Like & { raw: DatabaseSync } {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL(`../../config/d1/${schema}`, import.meta.url), 'utf8'));
  return {
    raw: db,
    prepare: sql => statement(db, sql),
    batch: async statements => {
      db.exec('BEGIN');
      try {
        const results: { results?: unknown[] }[] = [];
        for (const item of statements) {
          results.push(await item.all());
        }
        db.exec('COMMIT');
        return results;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }
  };
}

/**
 * `db`, counting the round trips made through it: each statement run on its
 * own is one, and so is a whole batch, which is what D1 charges a request in
 * waiting.
 */
export function countingTrips(db: D1Like): { db: D1Like; trips: () => number } {
  let trips = 0;
  const inner = new Map<D1Statement, D1Statement>();
  const counted = (statement: D1Statement): D1Statement => {
    const once =
      <T>(run: () => Promise<T>) =>
      () => {
        trips += 1;
        return run();
      };
    const wrapped: D1Statement = {
      bind: (...values) => counted(statement.bind(...values)),
      first: once(statement.first) as D1Statement['first'],
      all: once(statement.all) as D1Statement['all'],
      run: once(statement.run)
    };
    inner.set(wrapped, statement);
    return wrapped;
  };
  return {
    db: {
      prepare: sql => counted(db.prepare(sql)),
      batch: statements => {
        trips += 1;
        return db.batch(statements.map(statement => inner.get(statement) ?? statement));
      }
    },
    trips: () => trips
  };
}
