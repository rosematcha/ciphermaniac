/**
 * Player accounts end to end, against the real schema in SQLite. What must
 * hold: migration 0005 brings a live database in line with the schema, with
 * each POP ID left on one account and Reese the only admin.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { sqliteD1 } from '../__utils__/sqliteD1.ts';

const sql = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

/** Every table's columns and every index, as a database made from scratch and a migrated one must agree on. */
function shape(db: DatabaseSync) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
    name: string;
  }[];
  return {
    tables: tables.map(({ name }) => ({ name, columns: db.prepare(`PRAGMA table_info(${name})`).all() })),
    indexes: db
      .prepare("SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY name")
      .all()
  };
}

/** Accounts and events as a live database held them before 0005. */
function seedBefore0005(db: DatabaseSync) {
  const user = db.prepare('INSERT INTO users (id, name, email, pop_id, created_at) VALUES (?, ?, ?, ?, ?)');
  user.run('first', 'First', null, '111', 1);
  user.run('second', 'Second', null, '111', 2);
  user.run('blank', 'Blank', null, '', 2);
  user.run('tie-a', 'Tie A', null, '222', 3);
  user.run('tie-b', 'Tie B', null, '222', 3);
  user.run('reese', 'Reese', 'Reese@Rosematcha.com', null, 4);
  user.run('owner', 'Owner', 'owner@example.com', '333', 5);
  const event = db.prepare(
    'INSERT INTO tournaments (code, owner_id, mode, state, settings, staff_token, created_at, updated_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, 1, 1)'
  );
  const players = (...ids: string[]) => JSON.stringify({ players: ids.map(id => ({ id })) });
  // Stored before the sanctioned setting existed, so it reads as sanctioned.
  event.run('SANCTN', 'owner', 'swiss', players('111', '222'), '{}', 'a');
  event.run('CASUAL', 'owner', 'swiss', players('9000000001'), '{"sanctioned":false}', 'b');
  // A TOM event is sanctioned whatever its settings say.
  event.run('TOMRUN', 'reese', 'tom', players('333'), '{"sanctioned":false}', 'c');
}

test('migration 0005 brings a database made before accounts in line with the schema', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(sql('../fixtures/d1/tournaments-before-0005.sql'));
  seedBefore0005(db);
  db.exec(sql('../../config/d1/migrations/tournaments-0005-player-accounts.sql'));
  const backfill = sql('../../config/d1/migrations/tournaments-0006-pop-history-backfill.sql');
  db.exec(backfill);
  db.exec(backfill);

  assert.deepEqual(shape(db), shape(sqliteD1('tournaments.sql').raw));
  const users = db.prepare('SELECT id, pop_id AS popId, role, role_by AS roleBy FROM users ORDER BY id').all();
  assert.deepEqual(
    users.map(row => ({ ...row })),
    [
      { id: 'blank', popId: null, role: null, roleBy: null },
      { id: 'first', popId: '111', role: null, roleBy: null },
      { id: 'owner', popId: '333', role: null, roleBy: null },
      { id: 'reese', popId: null, role: 'admin', roleBy: null },
      { id: 'second', popId: null, role: null, roleBy: null },
      { id: 'tie-a', popId: '222', role: null, roleBy: null },
      { id: 'tie-b', popId: null, role: null, roleBy: null }
    ],
    'the oldest account keeps a POP ID, an empty one is none, Reese is admin and an event owner is not an organizer'
  );
  const seeded = db.prepare("SELECT role_at AS roleAt FROM users WHERE id = 'reese'").get() as { roleAt: number };
  assert.ok(Math.abs(seeded.roleAt - Date.now()) < 60_000, 'the seed records when, in milliseconds');
  const history = db.prepare('SELECT pop_id AS popId, code FROM pop_history ORDER BY code, pop_id').all();
  assert.deepEqual(
    history.map(row => ({ ...row })),
    [
      { popId: '111', code: 'SANCTN' },
      { popId: '222', code: 'SANCTN' },
      { popId: '333', code: 'TOMRUN' }
    ],
    'sanctioned events only, once each however often the back-fill runs'
  );
});
