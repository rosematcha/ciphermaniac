import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { clearDatabaseCache, loadDatabase } from '../../src/lib/database.ts';

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const require = createRequire(import.meta.url);

let dbBuffer: Uint8Array;

function buildDbBuffer(SQL: any): Uint8Array {
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE decks (
      id TEXT PRIMARY KEY,
      archetype TEXT,
      placement INTEGER
    );
  `);
  db.run(`
    CREATE TABLE deck_cards (
      deck_id TEXT,
      card_uid TEXT,
      card_name TEXT,
      card_set TEXT,
      card_number TEXT,
      category TEXT,
      trainer_type TEXT,
      energy_type TEXT,
      ace_spec INTEGER,
      count INTEGER
    );
  `);
  db.run(`
    CREATE TABLE success_tags (
      deck_id TEXT,
      tag TEXT
    );
  `);

  db.run('INSERT INTO decks (id, archetype, placement) VALUES (?, ?, ?);', ['d1', 'Mew', 1]);
  db.run('INSERT INTO decks (id, archetype, placement) VALUES (?, ?, ?);', ['d2', 'Gardevoir', 8]);

  db.run(
    `INSERT INTO deck_cards
      (deck_id, card_uid, card_name, card_set, card_number, category, trainer_type, energy_type, ace_spec, count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    ['d1', 'SVI-007', 'Pikachu', 'SVI', '7', 'pokemon', null, null, 0, 4]
  );
  db.run(
    `INSERT INTO deck_cards
      (deck_id, card_uid, card_name, card_set, card_number, category, trainer_type, energy_type, ace_spec, count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    ['d2', 'SVI-007', 'Pikachu', 'SVI', '7', 'pokemon', null, null, 0, 2]
  );

  db.run('INSERT INTO success_tags (deck_id, tag) VALUES (?, ?);', ['d1', 'winner']);
  db.run('INSERT INTO success_tags (deck_id, tag) VALUES (?, ?);', ['d2', 'top8']);

  const buffer = db.export();
  db.close();
  return buffer;
}

async function ensureSqlJs(): Promise<void> {
  if (dbBuffer) {
    return;
  }
  const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
  const sqljs = await import('sql.js');
  const initSqlJs = (sqljs as any).default ?? sqljs;
  const SQL = await initSqlJs({ locateFile: () => wasmPath });

  dbBuffer = buildDbBuffer(SQL);
  globalThis.window = {
    initSqlJs: async () => SQL
  } as Window & typeof globalThis;
}

test.before(async () => {
  await ensureSqlJs();
});

test.afterEach(async () => {
  globalThis.fetch = originalFetch;
  clearDatabaseCache();
});

test.after(() => {
  globalThis.window = originalWindow;
});

test('database filters decks and returns card stats for a workflow', async () => {
  globalThis.fetch = async () =>
    new Response(Buffer.from(dbBuffer), {
      status: 200,
      headers: { 'content-type': 'application/octet-stream' }
    });

  const db = await loadDatabase('test-tournament');
  const filteredDecks = db.filterDecks({
    archetype: 'Mew',
    successTags: ['winner'],
    includeCards: [{ cardUid: 'SVI-007', minCount: 3 }]
  });

  assert.equal(filteredDecks.length, 1);
  assert.equal(filteredDecks[0].id, 'd1');

  const stats = db.getFilteredCardStats({
    archetype: 'Mew',
    successTags: ['winner'],
    includeCards: [{ cardUid: 'SVI-007', minCount: 3 }]
  });

  assert.equal(stats.length, 1);
  assert.equal(stats[0].card_uid, 'SVI-007');
  assert.equal(stats[0].found, 1);
  assert.equal(stats[0].total, 1);
});
