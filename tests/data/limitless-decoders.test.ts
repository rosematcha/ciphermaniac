/**
 * Limitless response decoders (DB-MASTER-PLAN Phase 8.2).
 *
 * These responses become immutable published artifacts, so the thing worth
 * testing is not that valid input works — it is that invalid input is
 * distinguishable. A wrong SHAPE throws (the API moved); a bad ROW is dropped
 * and counted, so "we skipped 2 of 60" and "we skipped 60 of 60" can be told
 * apart. The second renders identically to a quiet day, which is exactly how a
 * pipeline publishes an artifact built from nothing and reports success.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decodeStandings,
  decodeTournamentDetails,
  decodeTournamentList,
  detectDecodeBreakage,
  LimitlessShapeError
} from '../../shared/api/limitlessDecoders.ts';

const VALID_TOURNAMENT = {
  id: 't1',
  name: 'Online Cup',
  date: '2026-08-01T10:00:00Z',
  format: 'STANDARD',
  game: 'PTCG',
  players: 128
};

// ---------------------------------------------------------------------------
// Shape vs rows
// ---------------------------------------------------------------------------

test('an endpoint returning the wrong top-level shape throws', () => {
  for (const raw of [{}, 'nope', null, 42]) {
    assert.throws(() => decodeTournamentList(raw), LimitlessShapeError, `list accepted ${JSON.stringify(raw)}`);
  }
  for (const raw of [[], 'nope', null, 7]) {
    assert.throws(() => decodeTournamentDetails(raw), LimitlessShapeError, `details accepted ${JSON.stringify(raw)}`);
  }
});

test('the shape error names what was expected and what arrived', () => {
  assert.throws(
    () => decodeTournamentList({ tournaments: [] }),
    (err: Error) => {
      assert.match(err.message, /expected an array/);
      assert.match(err.message, /got object/);
      return true;
    }
  );
});

test('an empty list is valid, not breakage', () => {
  const result = decodeTournamentList([]);
  assert.deepEqual(result, { rows: [], skipped: 0, seen: 0 });
  assert.equal(detectDecodeBreakage(result, 'list'), undefined);
});

// ---------------------------------------------------------------------------
// Tournament list rows
// ---------------------------------------------------------------------------

test('a valid tournament row survives with its fields', () => {
  const { rows, skipped } = decodeTournamentList([VALID_TOURNAMENT]);
  assert.equal(skipped, 0);
  assert.deepEqual(rows[0], {
    id: 't1',
    name: 'Online Cup',
    date: '2026-08-01T10:00:00Z',
    format: 'STANDARD',
    game: 'PTCG',
    players: 128
  });
});

test('a row missing id, name, or date is dropped and counted', () => {
  const raw = [
    VALID_TOURNAMENT,
    { ...VALID_TOURNAMENT, id: undefined },
    { ...VALID_TOURNAMENT, name: '' },
    { ...VALID_TOURNAMENT, date: undefined },
    'not an object',
    null
  ];
  const { rows, skipped, seen } = decodeTournamentList(raw);
  assert.equal(rows.length, 1);
  assert.equal(skipped, 5);
  assert.equal(seen, 6);
});

test('a row whose date cannot be parsed is dropped, not passed through', () => {
  // The caller windows on this date and treats an unparseable one as "older
  // than the window", which would silently truncate the crawl at that row.
  const { rows, skipped } = decodeTournamentList([{ ...VALID_TOURNAMENT, date: 'last thursday' }]);
  assert.equal(rows.length, 0);
  assert.equal(skipped, 1);
});

test('optional fields become undefined rather than empty strings or NaN', () => {
  const { rows } = decodeTournamentList([{ id: 't1', name: 'X', date: '2026-08-01' }]);
  assert.equal(rows[0].format, undefined);
  assert.equal(rows[0].game, undefined);
  assert.equal(rows[0].players, undefined);
});

test('a numeric string player count is accepted, and a non-numeric one becomes undefined rather than NaN', () => {
  const { rows } = decodeTournamentList([
    { ...VALID_TOURNAMENT, players: '128' },
    { ...VALID_TOURNAMENT, players: 'lots' }
  ]);
  assert.equal(rows[0].players, 128);
  assert.equal(rows[1].players, undefined);
});

// ---------------------------------------------------------------------------
// Details — absent must stay distinguishable from false
// ---------------------------------------------------------------------------

test('booleans keep absent, false, and unrecognized apart', () => {
  // The caller filters with `=== false`, so "unknown" must not become "no",
  // and a non-boolean like 'yes' must not be read as a decision either way.
  const cases: Array<[Record<string, unknown>, boolean | undefined]> = [
    [{}, undefined],
    [{ decklists: false, isOnline: false }, false],
    [{ decklists: 'yes', isOnline: 1 }, undefined]
  ];
  for (const [raw, expected] of cases) {
    const details = decodeTournamentDetails(raw);
    assert.equal(details.decklists, expected, `decklists from ${JSON.stringify(raw)}`);
    assert.equal(details.isOnline, expected, `isOnline from ${JSON.stringify(raw)}`);
  }
});

test('a malformed organizer becomes undefined rather than throwing', () => {
  assert.equal(decodeTournamentDetails({ organizer: 'Acme' }).organizer, undefined);
  assert.deepEqual(decodeTournamentDetails({ organizer: { name: 'Acme' } }).organizer, { name: 'Acme' });
});

// ---------------------------------------------------------------------------
// Standings
// ---------------------------------------------------------------------------

test('a standings row needs to identify a player somehow', () => {
  const raw = [{ player: 'Ash', placing: 1 }, { name: 'Misty', placing: 2 }, { placing: 3 }, { player: '   ' }, null];
  const { rows, skipped, seen } = decodeStandings(raw);
  assert.equal(rows.length, 2);
  assert.equal(skipped, 3);
  assert.equal(seen, 5);
});

test('a decklist object passes through structurally unchecked, and a non-object becomes undefined', () => {
  // toCardEntries is the one place that interprets a decklist; duplicating its
  // tolerance here would mean two places to keep in sync.
  const decklist = { pokemon: [{ name: 'Pikachu', count: 4 }] };
  const { rows } = decodeStandings([
    { player: 'Ash', decklist },
    { player: 'Misty', decklist: 'oops' }
  ]);
  assert.deepEqual(rows[0].decklist, decklist);
  assert.equal(rows[1].decklist, undefined);
});

test('a deck reference survives partially', () => {
  const { rows } = decodeStandings([{ player: 'Ash', deck: { id: null, name: 'Dragapult' } }]);
  assert.deepEqual(rows[0].deck, { id: null, name: 'Dragapult' });
});

// ---------------------------------------------------------------------------
// Breakage detection — the part that matters
// ---------------------------------------------------------------------------

test('losing all or most rows of a non-empty response is breakage; a minority is upstream noise', () => {
  const cases: Array<[string, unknown[], RegExp | undefined]> = [
    ['every row lost', [{ nope: 1 }, { nope: 2 }], /discarded all 2 rows/],
    ['a majority lost', [VALID_TOURNAMENT, { bad: 1 }, { bad: 2 }], /discarded 2 of 3/],
    ['a minority lost', [VALID_TOURNAMENT, { ...VALID_TOURNAMENT, id: 't2' }, { bad: 1 }], undefined],
    ['a clean decode', [VALID_TOURNAMENT], undefined]
  ];
  for (const [label, raw, expected] of cases) {
    const breakage = detectDecodeBreakage(decodeTournamentList(raw), 'list');
    if (expected) {
      assert.match(String(breakage), expected, label);
    } else {
      assert.equal(breakage, undefined, label);
    }
  }
});
