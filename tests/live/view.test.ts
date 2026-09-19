/**
 * Reading a live round. The rule that matters is the refusal: a name two
 * players in the round share, or that two known careers share, matches nobody.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { LiveMatch, LiveSeat } from '../../shared/live/types.ts';
import { aliasedPlayerId, seatNamesFor } from '../../shared/live/seatAliases.ts';
import {
  createProfileLookup,
  filterByDeck,
  filterByStatus,
  filterMatches,
  filterStandings,
  findSeat,
  findSeats,
  foldName,
  followedMatches,
  isDecided,
  matchStatus,
  playerRun,
  recordLabel,
  seatKey,
  seatMatchesSlug,
  seatOutcome,
  seatSlug,
  standings
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
  const view = findSeat(MATCHES, ['jose nunez'], ['MX']);
  assert.equal(view?.match.table, 1);
  assert.equal(view?.opponent?.name, 'Ada Lovelace');
});

test('a bye has no opponent', () => {
  assert.equal(findSeat(MATCHES, ['Barbara Liskov'], ['US'])?.opponent, undefined);
});

test('a name shared inside the round matches nobody', () => {
  assert.equal(findSeat(MATCHES, ['Eric Chen'], ['US']), null);
});

test('a contradicting country rules a seat out; an unknown one does not', () => {
  assert.equal(findSeat(MATCHES, ['Ada Lovelace'], ['US']), null);
  assert.equal(findSeat(MATCHES, ['Ada Lovelace'], [])?.match.table, 1);
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
  assert.equal(profileOf(seat('ADA LOVELACE', 'GB'))?.playerId, '1');
  assert.equal(profileOf(seat('Ada Lovelace', 'US')), null);
  assert.equal(profileOf(seat('Eric Chen')), null);
  assert.deepEqual(profileOf(seat('Grace Hopper')), { playerId: '4', name: 'Grace Hopper' });
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
  const run = playerRun(rounds, ['Barbara Liskov'], ['US']);
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

test('an all-digit query is a table number as well as a name fragment', () => {
  assert.deepEqual(
    filterMatches(MATCHES, '3').map(match => match.table),
    [3]
  );
  assert.deepEqual(
    filterMatches(MATCHES, '99').map(match => match.table),
    []
  );
});

test('the status filter splits the tables still on from the ones settled', () => {
  assert.deepEqual(
    filterByStatus(MATCHES, 'playing').map(match => match.table),
    [1]
  );
  assert.deepEqual(
    filterByStatus(MATCHES, 'decided').map(match => match.table),
    [2, 3, 0]
  );
  assert.equal(filterByStatus(MATCHES, 'all').length, MATCHES.length);
});

test('the deck filter keeps a table where either seat is on the archetype', () => {
  const deckOf = (ref: { name: string }) => (ref.name === 'Alan Turing' ? 'Dragapult' : undefined);
  assert.deepEqual(
    filterByDeck(MATCHES, 'Dragapult', deckOf).map(match => match.table),
    [3]
  );
});

test('an aliased seat resolves to the career its registered name hides', () => {
  const profileOf = createProfileLookup(
    [
      { playerId: '9397', name: 'Caitlin White', country: 'CA' },
      { playerId: '1', name: 'Ada Lovelace', country: 'GB' }
    ],
    aliasedPlayerId
  );
  assert.deepEqual(profileOf({ name: 'Cali White', country: 'CA' }), {
    playerId: '9397',
    name: 'Caitlin White'
  });
  // The alias pins its country; a seat from anywhere else is a different person.
  assert.equal(profileOf({ name: 'Cali White', country: 'US' }), null);
  assert.equal(profileOf(seat('Ada Lovelace', 'GB'))?.playerId, '1');
});

test('a career is searched for under every name its player registers with', () => {
  assert.deepEqual(seatNamesFor('9397', 'Caitlin White'), ['Caitlin White', 'Cali White']);
  assert.deepEqual(seatNamesFor('1', 'Ada Lovelace'), ['Ada Lovelace']);
  const round = [{ table: 7, seats: [seat('Cali White', 'CA'), seat('Ada Lovelace', 'GB')], complete: false }];
  assert.equal(findSeat(round, seatNamesFor('9397', 'Caitlin White'), ['CA'])?.match.table, 7);
});

test('the seat key stays on the registered name, so follows and reports survive an alias', () => {
  assert.equal(seatKey({ name: 'Cali White', country: 'CA' }), 'cali white|CA');
});

test('a seat slug folds the name and carries the country, and matches only its own seat', () => {
  assert.equal(seatSlug({ name: 'José Núñez', country: 'MX' }), 'jose-nunez--mx');
  assert.equal(seatSlug({ name: "Alan O'Neill-Jones Jr.", country: '' }), 'alan-o-neill-jones-jr');
  assert.ok(seatMatchesSlug({ name: 'JOSÉ  Núñez', country: 'MX' }, 'jose-nunez--mx'));
  // Same name, different country: a different person, and a different page.
  assert.ok(!seatMatchesSlug({ name: 'José Núñez', country: 'ES' }, 'jose-nunez--mx'));
  // A surname is not a country code, and the doubled separator says so.
  assert.equal(seatSlug({ name: 'Alan Lee', country: '' }), 'alan-lee');
  assert.equal(seatSlug({ name: 'Alan', country: 'LEE' }), 'alan--lee');
  assert.ok(!seatMatchesSlug({ name: 'Alan', country: 'LEE' }, 'alan-lee'));
});

test('two seats sharing a name are both returned, so a page can say which is which', () => {
  assert.deepEqual(
    findSeats(MATCHES, ['Eric Chen'], ['US']).map(view => view.match.table),
    [2, 3]
  );
});

test('standings fold this round into the record RK9 posted going into it', () => {
  const round: LiveMatch[] = [
    {
      table: 1,
      seats: [
        { name: 'Winner', country: 'US', wins: 6, losses: 0, ties: 0, points: 18, result: 'win' },
        { name: 'Loser', country: 'US', wins: 5, losses: 1, ties: 0, points: 15, result: 'loss' }
      ],
      complete: true
    },
    {
      table: 2,
      seats: [
        { name: 'Ongoing', country: 'US', wins: 5, losses: 1, ties: 0, points: 15 },
        { name: 'Other', country: 'US', wins: 5, losses: 1, ties: 0, points: 15 }
      ],
      complete: false
    }
  ];
  const table = standings(round);
  assert.deepEqual(
    table.map(row => [row.seat.name, recordLabel(row), row.points, row.place]),
    [
      ['Winner', '7-0-0', 21, 1],
      ['Loser', '5-2-0', 15, 2],
      ['Ongoing', '5-1-0', 15, 2],
      ['Other', '5-1-0', 15, 2]
    ]
  );
  assert.deepEqual(
    filterStandings(table, 'win').map(row => row.seat.name),
    ['Winner']
  );
});

test('folding is memoised without confusing one name for another', () => {
  // The cache is keyed on the raw string, so repeated folds agree and distinct
  // names stay distinct however often the search re-runs.
  assert.equal(foldName('José Núñez'), foldName('José Núñez'));
  assert.equal(foldName('José Núñez'), 'jose nunez');
  assert.equal(foldName('Jose Nunez'), 'jose nunez');
  assert.equal(foldName('Ada Lovelace'), 'ada lovelace');
  assert.equal(foldName('José Núñez'), 'jose nunez');
});

test('a seat answers to the career name it is aliased to, as well as the printed one', () => {
  const extra = (match: LiveMatch) => (match.table === 2 ? ['caitlin white'] : undefined);
  const round: LiveMatch[] = [
    { table: 1, seats: [seat('Ada Lovelace', 'GB'), seat('Grace Hopper')], complete: false },
    { table: 2, seats: [seat('Cali White', 'CA'), seat('Alan Turing', 'GB')], complete: false }
  ];
  assert.deepEqual(
    filterMatches(round, 'caitlin', extra).map(match => match.table),
    [2]
  );
  assert.deepEqual(
    filterMatches(round, 'cali', extra).map(match => match.table),
    [2],
    'the name RK9 prints still finds them'
  );
  assert.deepEqual(
    filterMatches(round, 'caitlin').map(match => match.table),
    []
  );
});

test('standings search takes a table number and an aliased name too', () => {
  const round: LiveMatch[] = [
    { table: 7, seats: [seat('Cali White', 'CA'), seat('Alan Turing', 'GB')], complete: false }
  ];
  const rows = standings(round);
  const extra = (match: LiveMatch) => (match.table === 7 ? ['caitlin white'] : undefined);
  assert.equal(filterStandings(rows, '7').length, 2, 'a table number keeps both of its seats');
  assert.deepEqual(
    filterStandings(rows, 'caitlin', extra).map(row => row.seat.name),
    ['Cali White', 'Alan Turing'],
    'the alias is a property of the table, so it keeps the table'
  );
});

test('a bye goes last among equal points, not first', () => {
  const round: LiveMatch[] = [
    {
      table: 0,
      seats: [{ name: 'Bye Taker', country: 'US', wins: 2, losses: 0, ties: 0, points: 6, result: 'win' }],
      complete: true
    },
    {
      table: 5,
      seats: [
        { name: 'Seated Winner', country: 'US', wins: 2, losses: 0, ties: 0, points: 6, result: 'win' },
        { name: 'Seated Loser', country: 'US', wins: 0, losses: 2, ties: 0, points: 0, result: 'loss' }
      ],
      complete: true
    }
  ];
  assert.deepEqual(
    standings(round).map(row => row.seat.name),
    ['Seated Winner', 'Bye Taker', 'Seated Loser']
  );
});
