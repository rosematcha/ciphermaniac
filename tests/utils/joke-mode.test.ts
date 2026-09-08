/**
 * tests/utils/joke-mode.test.ts
 * The September 10th arts: which cards have one, and when they show.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { isJokeArt, isJokeDay, isJokeMode, jokeArtNumber } from '../../src/lib/jokeMode.ts';

/** Local-time constructor: the joke is keyed to the visitor's own calendar. */
const at = (month: number, day: number) => new Date(2026, month - 1, day, 12, 0, 0);

test('the day is September 10th in local time, and nothing either side of it', () => {
  assert.equal(isJokeDay(at(9, 10)), true);
  assert.equal(isJokeDay(at(9, 9)), false);
  assert.equal(isJokeDay(at(9, 11)), false);
  assert.equal(isJokeDay(at(10, 10)), false);
});

test("the day covers the visitor's whole local day, midnight to midnight", () => {
  assert.equal(isJokeDay(new Date(2026, 8, 10, 0, 0, 0)), true);
  assert.equal(isJokeDay(new Date(2026, 8, 10, 23, 59, 59)), true);
});

test('?j=1 turns the arts on out of season, and any other value does not', () => {
  assert.equal(isJokeMode('1', at(3, 4)), true);
  assert.equal(isJokeMode(undefined, at(3, 4)), false);
  assert.equal(isJokeMode('0', at(3, 4)), false);
  assert.equal(isJokeMode(['1'], at(3, 4)), false);
  assert.equal(isJokeMode(undefined, at(9, 10)), true);
});

test('only the five cards have an art, matched on the exact name', () => {
  assert.equal(jokeArtNumber('Budew'), '002');
  assert.equal(jokeArtNumber("Boss's Orders"), '001');
  assert.equal(jokeArtNumber("Lillie's Determination"), '005');
  assert.equal(jokeArtNumber('budew'), null);
  assert.equal(jokeArtNumber('Night Stretcher'), null);
  assert.equal(jokeArtNumber('toString'), null);
});

test('only the five bundled numbers divert to the bundle, and only under UVU', () => {
  assert.equal(isJokeArt('UVU', '002'), true);
  assert.equal(isJokeArt('uvu', '005'), true);
  assert.equal(isJokeArt('UVU', '087'), false);
  assert.equal(isJokeArt('ASC', '002'), false);
});
