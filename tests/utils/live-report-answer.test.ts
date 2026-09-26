/**
 * What a seat shows after this device reports it: the endpoint's answer while
 * the published file in hand predates the report, then the file again, so a
 * later change by anyone else is not hidden for the rest of the session.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { LiveReports } from '../../shared/live/reports.ts';
import { shownDeck } from '../../src/lib/liveReports.ts';

const SEAT = 'ada lovelace|GB';
const file = (updatedAt: string, deck?: string): LiveReports => ({
  updatedAt,
  decks: deck ? { [SEAT]: deck } : {}
});
const at = '2026-09-26T12:00:05.000Z';
const answer = { archetypes: { [SEAT]: 'Dragapult' }, updatedAt: at };

test('with no answer for the seat, the published file is what shows', () => {
  assert.equal(shownDeck(undefined, file('2026-09-26T12:00:00.000Z', 'Gardevoir'), SEAT), 'Gardevoir');
  assert.equal(shownDeck(undefined, null, SEAT), undefined);
  assert.equal(shownDeck(answer, file('2026-09-26T12:00:00.000Z', 'Gardevoir'), 'grace hopper|US'), undefined);
});

test('the answer shows over a file from before the report, and before any file has loaded', () => {
  assert.equal(shownDeck(answer, file('2026-09-26T12:00:00.000Z'), SEAT), 'Dragapult');
  assert.equal(shownDeck(answer, undefined, SEAT), 'Dragapult');
  assert.equal(shownDeck(answer, null, SEAT), 'Dragapult');
});

test('a file as new as the answer takes over, and so does a newer one that disagrees', () => {
  assert.equal(shownDeck(answer, file(at, 'Dragapult'), SEAT), 'Dragapult');
  assert.equal(shownDeck(answer, file('2026-09-26T12:03:00.000Z', 'Gardevoir'), SEAT), 'Gardevoir');
  assert.equal(shownDeck(answer, file('2026-09-26T12:03:00.000Z'), SEAT), undefined);
});

test('a retraction hides the seat until a file shows it again', () => {
  const retracted = { archetypes: { [SEAT]: null }, updatedAt: at };
  assert.equal(shownDeck(retracted, file('2026-09-26T12:00:00.000Z', 'Dragapult'), SEAT), null);
  assert.equal(shownDeck(retracted, file('2026-09-26T12:03:00.000Z', 'Gardevoir'), SEAT), 'Gardevoir');
});

test('an answer given before any file existed yields to the first file read', () => {
  const unpublished = { archetypes: { [SEAT]: null }, updatedAt: null };
  assert.equal(shownDeck(unpublished, file('2026-09-26T12:00:00.000Z', 'Gardevoir'), SEAT), 'Gardevoir');
  assert.equal(shownDeck(unpublished, null, SEAT), null);
});
