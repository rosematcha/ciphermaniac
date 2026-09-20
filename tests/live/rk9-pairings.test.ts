/**
 * RK9 pairings round parser.
 *
 * The fixture mirrors RK9's markup byte for byte, names aside, and carries one
 * row of every shape seen during a live round: confirmed win, tie, drop, bye,
 * unpaired loss, a table still playing, and both kinds of submitted result. As
 * with the upcoming parser, the property that matters most is that a markup
 * change cannot pass for a round that has not been posted.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { detectRoundBreakage, parseRk9Round } from '../../shared/live/rk9Pairings.ts';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/live');

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, `${name}.html`), 'utf8');
}

const round = parseRk9Round(fixture('round'));
const byTable = (table: number) => round.matches.filter(match => match.table === table);

test('every row of the round parses', () => {
  assert.equal(round.rowsSeen, 8);
  assert.equal(round.rowsSkipped, 0);
  assert.equal(round.topCut, false);
  assert.equal(detectRoundBreakage(round), undefined);
});

test('a top cut round, which prints no points, parses and says so', () => {
  const cut = parseRk9Round(fixture('round-top-cut'));
  assert.equal(cut.rowsSeen, 4);
  assert.equal(cut.rowsSkipped, 0);
  assert.equal(cut.topCut, true);
  assert.equal(detectRoundBreakage(cut), undefined);
  assert.deepEqual(cut.matches[0], {
    table: 518,
    complete: true,
    seats: [
      { name: 'Ada Lovelace', country: 'US', wins: 12, losses: 1, ties: 2, points: 38, result: 'loss' },
      { name: 'Grace Hopper', country: 'US', wins: 12, losses: 1, ties: 2, points: 38, result: 'win' }
    ]
  });
});

test('a confirmed match carries names, countries, records and results', () => {
  const [match] = byTable(101);
  assert.equal(match.complete, true);
  assert.deepEqual(match.seats, [
    { name: 'Ada Lovelace', country: 'GB', wins: 2, losses: 1, ties: 0, points: 6, result: 'loss' },
    { name: 'Grace Hopper', country: 'US', wins: 3, losses: 0, ties: 0, points: 9, result: 'win' }
  ]);
});

test('a tie marks both seats', () => {
  assert.deepEqual(
    byTable(102)[0].seats.map(seat => seat.result),
    ['tie', 'tie']
  );
});

test('a drop is recorded on the seat that dropped, and multi-word names survive', () => {
  const [winner, loser] = byTable(103)[0].seats;
  assert.equal(winner.name, 'Mary Ann De La Cruz');
  assert.equal(winner.dropped, undefined);
  assert.equal(loser.dropped, true);
});

test('table 0 rows have one seat: a bye is a win, an unpaired row a loss', () => {
  const solo = byTable(0);
  assert.deepEqual(
    solo.map(match => [match.seats.length, match.seats[0].name, match.seats[0].result]),
    [
      [1, 'Barbara Liskov', 'win'],
      [1, 'Dennis Ritchie', 'loss']
    ]
  );
});

test('a table still playing has no results, and entities in names are decoded', () => {
  const [match] = byTable(104);
  assert.equal(match.complete, false);
  assert.equal(match.submitted, undefined);
  assert.equal(match.seats[0].name, "Amy D'sa");
  assert.deepEqual(
    match.seats.map(seat => seat.result),
    [undefined, undefined]
  );
});

test('a submitted result names its side without becoming a result', () => {
  assert.equal(byTable(105)[0].submitted, 'p2');
  assert.equal(byTable(106)[0].submitted, 'tie');
  assert.equal(byTable(105)[0].seats[1].result, undefined);
});

test('an empty body is a round that is not posted, not breakage', () => {
  const empty = parseRk9Round('');
  assert.deepEqual(empty, { matches: [], rowsSeen: 0, rowsSkipped: 0, truncated: false, topCut: false });
  assert.equal(detectRoundBreakage(empty), undefined);
});

test('rows that stop parsing are reported as breakage', () => {
  const broken = parseRk9Round(fixture('round-renamed'));
  assert.equal(broken.rowsSeen, 8);
  assert.equal(broken.matches.length, 0);
  assert.match(detectRoundBreakage(broken) ?? '', /8 of 8 match rows unreadable/);
});

test('a body cut off mid-row is breakage even though its earlier rows parse', () => {
  const whole = fixture('round');
  const cut = parseRk9Round(whole.slice(0, whole.lastIndexOf('<div class="row')));
  assert.equal(cut.truncated, false);
  const midRow = parseRk9Round(whole.slice(0, whole.lastIndexOf('<span class="name"')));
  assert.equal(midRow.truncated, true);
  assert.match(detectRoundBreakage(midRow) ?? '', /cut short/);
});
