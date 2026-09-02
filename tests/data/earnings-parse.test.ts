/**
 * Reading a Limitless results row.
 *
 * The cash column is abbreviated — `2.5K$` is $2,500 — and getting it wrong is
 * silent: totals just come out small. These pin the formats the site actually
 * uses, surveyed across 20 player pages.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseCash,
  parseCrawledIds,
  parsePlace,
  parseSeasonKey,
  parseTournamentRef
} from '../../shared/earningsParse.ts';

test('abbreviated thousands expand', () => {
  assert.equal(parseCash('2.5K$'), 2500);
  assert.equal(parseCash('1K$'), 1000);
  assert.equal(parseCash('7.5K$'), 7500);
  assert.equal(parseCash('50K$'), 50000);
});

test('plain amounts pass through, with or without separators', () => {
  assert.equal(parseCash('750$'), 750);
  assert.equal(parseCash('250$'), 250);
  assert.equal(parseCash('77,000$'), 77000);
  assert.equal(parseCash('$1,500'), 1500);
});

test('an empty cell is no money, not a parse failure', () => {
  assert.equal(parseCash(''), 0);
  assert.equal(parseCash('   '), 0);
});

test('an unrecognized amount throws rather than silently counting as zero', () => {
  // A silent 0 here is indistinguishable from a genuine non-cashing finish,
  // which is exactly how a format change would corrupt every total unnoticed.
  assert.throws(() => parseCash('two thousand'), /Unrecognized cash value/);
  assert.throws(() => parseCash('1.2M$'), /Unrecognized cash value/);
});

test('placements read as numbers, and a blank cell has none', () => {
  assert.equal(parsePlace('1st'), 1);
  assert.equal(parsePlace('21st'), 21);
  assert.equal(parsePlace('126th'), 126);
  assert.equal(parsePlace(''), null);
  assert.equal(parsePlace('—'), null);
});

test('season headings become two-digit span keys', () => {
  assert.equal(parseSeasonKey('Season 2019–2020'), '1920');
  assert.equal(parseSeasonKey('Season 2025–2026'), '2526');
  assert.equal(parseSeasonKey('Detailed tournament history'), null);
});

test('resume reads back the ids a previous run captured', () => {
  const ndjson = ['{"id":"1","results":[]}', '{"id":"2","results":[]}', ''].join('\n');
  const { ids, torn } = parseCrawledIds(ndjson);
  assert.deepEqual([...ids], ['1', '2']);
  assert.equal(torn, 0);
});

test('a line torn by a killed process is dropped, not thrown on', () => {
  // Killing the crawl mid-append leaves a half-written line. It must not make
  // the whole cache unreadable — the id it belonged to is simply re-fetched.
  const ndjson = '{"id":"1","results":[]}\n{"id":"2","resu';
  const { ids, lines, torn } = parseCrawledIds(ndjson);
  assert.deepEqual([...ids], ['1']);
  assert.equal(torn, 1);
  // The caller rewrites the file from `lines`, leaving clean JSON behind.
  assert.deepEqual(lines, ['{"id":"1","results":[]}']);
});

test('a record without an id counts as torn rather than resuming a blank', () => {
  const { ids, torn } = parseCrawledIds('{"results":[]}');
  assert.equal(ids.size, 0);
  assert.equal(torn, 1);
});

test('a tournament link yields the numeric id, not its trailing division code', () => {
  // Taking the last path segment reads "SR" as the tournament id, which makes
  // every Junior/Senior finish fail its tier lookup and restate to $0.
  assert.deepEqual(parseTournamentRef('/tournaments/522'), { id: '522', division: 'masters' });
  assert.deepEqual(parseTournamentRef('/tournaments/375/SR'), { id: '375', division: 'junior-senior' });
  assert.deepEqual(parseTournamentRef('/tournaments/210/JR'), { id: '210', division: 'junior-senior' });
});

test('an explicit Masters suffix reads as Masters', () => {
  assert.deepEqual(parseTournamentRef('/tournaments/9/MA'), { id: '9', division: 'masters' });
});

test('a non-tournament link has no reference, and an unknown suffix throws', () => {
  assert.equal(parseTournamentRef('/decks/list/3730'), null);
  assert.equal(parseTournamentRef(''), null);
  assert.throws(() => parseTournamentRef('/tournaments/5/XX'), /Unrecognized division suffix/);
});
