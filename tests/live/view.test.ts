/**
 * Reading a live round. The rule that matters is the refusal: a name two
 * players in the round share, or that two known careers share, matches nobody.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { LiveMatch, LiveSeat } from '../../shared/live/types.ts';
import {
  createProfileLookup,
  filterMatches,
  findSeat,
  foldName,
  followedMatches,
  isDecided,
  matchStatus,
  playerRun,
  recordLabel,
  seatKey,
  seatOutcome
} from '../../shared/live/view.ts';

function seat(name: string, country = 'US'): LiveSeat {
  return { name, country, wins: 2, losses: 1, ties: 0, points: 6 };
}

const MATCHES: LiveMatch[] = [
  { table: 1, seats: [seat('Ada Lovelace', 'GB'), seat('José Núñez', 'MX')], complete: false },
  { table: 2, seats: [seat('Eric Chen'), seat('Grace Hopper')], complete: false, submitted: 'p1' },
  { table: 3, seats: [seat('Eric Chen'), seat('Alan Turing', 'GB')], complete: true },
  { table: 0, seats: [seat('Barbara Liskov')], complete: true }
];

test('names fold case, accents and spacing away', () => {
  assert.equal(foldName('  JOSÉ   Núñez '), 'jose nunez');
});

test('a player is found with their opponent', () => {
  const view = findSeat(MATCHES, 'jose nunez', ['MX']);
  assert.equal(view?.match.table, 1);
  assert.equal(view?.opponent?.name, 'Ada Lovelace');
});

test('a bye has no opponent', () => {
  assert.equal(findSeat(MATCHES, 'Barbara Liskov', ['US'])?.opponent, undefined);
});

test('a name shared inside the round matches nobody', () => {
  assert.equal(findSeat(MATCHES, 'Eric Chen', ['US']), null);
});

test('a contradicting country rules a seat out; an unknown one does not', () => {
  assert.equal(findSeat(MATCHES, 'Ada Lovelace', ['US']), null);
  assert.equal(findSeat(MATCHES, 'Ada Lovelace', [])?.match.table, 1);
});

test('the search keeps tables where either seat matches', () => {
  assert.deepEqual(
    filterMatches(MATCHES, 'chen').map(match => match.table),
    [2, 3]
  );
  assert.equal(filterMatches(MATCHES, '  ').length, MATCHES.length);
});

test('status and record read off the match and seat', () => {
  assert.deepEqual(MATCHES.map(matchStatus), ['playing', 'submitted', 'final', 'final']);
  assert.equal(recordLabel(seat('Anyone')), '2-1-0');
});

test('a seat links to a career only when exactly one known player has the name', () => {
  const profileOf = createProfileLookup([
    { playerId: '1', name: 'Ada Lovelace', country: 'GB' },
    { playerId: '2', name: 'Eric Chen', country: 'US' },
    { playerId: '3', name: 'Eric Chen', country: 'US' },
    { playerId: '4', name: 'Grace Hopper' }
  ]);
  assert.equal(profileOf(seat('ADA LOVELACE', 'GB')), '1');
  assert.equal(profileOf(seat('Ada Lovelace', 'US')), null);
  assert.equal(profileOf(seat('Eric Chen')), null);
  assert.equal(profileOf(seat('Grace Hopper')), '4');
  assert.equal(profileOf(seat('Nobody Known')), null);
});

test('a run follows one player through the posted rounds, oldest first, skipping unposted ones', () => {
  const rounds = [
    { round: 2, updatedAt: '', unreadable: 0, matches: [MATCHES[3]] },
    null,
    {
      round: 1,
      updatedAt: '',
      unreadable: 0,
      matches: [{ table: 9, seats: [seat('Barbara Liskov'), seat('Alan Turing', 'GB')], complete: true }]
    },
    { round: 3, updatedAt: '', unreadable: 0, matches: [MATCHES[0]] }
  ];
  const run = playerRun(rounds, 'Barbara Liskov', ['US']);
  assert.deepEqual(
    run.map(entry => [entry.round, entry.view?.opponent?.name ?? null, entry.view?.match.table ?? null]),
    [
      [1, 'Alan Turing', 9],
      [2, null, 0],
      [3, null, null]
    ]
  );
});

test('follows are kept by folded name and country, and pick out their tables', () => {
  assert.equal(seatKey(seat('José Núñez', 'MX')), 'jose nunez|MX');
  const follows = new Set([seatKey(seat('Grace Hopper')), seatKey(seat('Nobody Here'))]);
  assert.deepEqual(
    followedMatches(MATCHES, follows).map(match => match.table),
    [2]
  );
});

test('a confirmed result stands; a submitted one is shown provisionally for both seats', () => {
  const confirmed: LiveMatch = {
    table: 5,
    seats: [
      { ...seat('Ada Lovelace', 'GB'), result: 'win' },
      { ...seat('Grace Hopper'), result: 'loss' }
    ],
    complete: true
  };
  assert.deepEqual(seatOutcome(confirmed, 0), { result: 'win', provisional: false });
  const submitted: LiveMatch = {
    table: 6,
    seats: [seat('Alan Turing'), seat('Barbara Liskov')],
    complete: false,
    submitted: 'p2'
  };
  assert.deepEqual(seatOutcome(submitted, 0), { result: 'loss', provisional: true });
  assert.deepEqual(seatOutcome(submitted, 1), { result: 'win', provisional: true });
  assert.deepEqual(seatOutcome({ ...submitted, submitted: 'tie' }, 0), { result: 'tie', provisional: true });
  assert.equal(seatOutcome({ ...submitted, submitted: undefined }, 0), null);
});

test('a table is decided once a result is confirmed or submitted', () => {
  assert.deepEqual(MATCHES.map(isDecided), [false, true, true, true]);
});
