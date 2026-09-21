/**
 * The compact list index behind the card page's lists.
 *
 * What has to hold: every repeated string is stored once and referenced by
 * position, a deck with nothing to show is left out, and a single-event report
 * (whose deck rows name no tournament) still says where each list was played.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildListIndex,
  LIST_INDEX_SCHEMA_VERSION,
  LIST_INDEX_TAGS,
  type ListIndexInputDeck
} from '../../shared/data/reports/listIndex.ts';

const BOSS = { name: "Boss's Orders", set: 'MEG', number: '114', count: 3, category: 'trainer' };
const DREEPY = { name: 'Dreepy', set: 'TWM', number: 128, count: 4, category: 'pokemon' };
const FIRE = { name: 'Fire Energy', count: 5, category: 'energy' };

function online(overrides: Partial<ListIndexInputDeck> = {}): ListIndexInputDeck {
  return {
    player: 'Mew urshifu',
    country: 'US',
    placement: 1,
    archetype: 'Dragapult',
    successTags: ['winner', 'top8'],
    cards: [DREEPY, BOSS],
    tournamentId: 't1',
    tournamentName: 'League Challenge',
    tournamentDate: '2026-09-20T20:30:00.000Z',
    tournamentPlayers: 142,
    ...overrides
  };
}

test('an empty report has no index', () => {
  assert.equal(buildListIndex([]), null);
  assert.equal(buildListIndex(null), null);
  assert.equal(buildListIndex([online({ cards: [] })]), null);
});

test('cards, archetypes and events are stored once and referenced by position', () => {
  const index = buildListIndex([online(), online({ player: 'Takumi T', placement: 2, successTags: ['top8'] })]);
  assert.ok(index);
  assert.equal(index.schemaVersion, LIST_INDEX_SCHEMA_VERSION);
  assert.deepEqual(index.tags, [...LIST_INDEX_TAGS]);
  assert.deepEqual(index.archetypes, ['Dragapult']);
  assert.deepEqual(index.events, [['t1', 'League Challenge', '2026-09-20', 142]]);
  assert.deepEqual(index.cards, [
    ['Dreepy', 'TWM', '128', 'pokemon'],
    ["Boss's Orders", 'MEG', '114', 'trainer']
  ]);
  assert.deepEqual(index.decks, [
    ['Mew urshifu', 'US', 1, 0, 0, 0b1001, [0, 4, 1, 3]],
    ['Takumi T', 'US', 2, 0, 0, 0b1000, [0, 4, 1, 3]]
  ]);
});

test('a printing is its own dictionary entry, and a bare-name card keeps empty set and number', () => {
  const reprint = { ...BOSS, set: 'PAL', number: '172' };
  const index = buildListIndex([online({ cards: [BOSS, FIRE] }), online({ cards: [reprint] })]);
  assert.deepEqual(index?.cards, [
    ["Boss's Orders", 'MEG', '114', 'trainer'],
    ['Fire Energy', '', '', 'energy'],
    ["Boss's Orders", 'PAL', '172', 'trainer']
  ]);
});

test('decks without a published list, and card rows without a name or count, are left out', () => {
  const index = buildListIndex([
    online({ hasDecklist: false }),
    online({ player: 'Listed', cards: [BOSS, { name: '', count: 2 }, { name: 'Switch', count: 0 }] })
  ]);
  assert.equal(index?.decks.length, 1);
  assert.deepEqual(index?.decks[0]?.[6], [0, 3]);
});

test('unknown tags are ignored and tag case does not matter', () => {
  const index = buildListIndex([online({ successTags: ['TOP50', 'day2'] })]);
  assert.equal(index?.decks[0]?.[5], 1 << LIST_INDEX_TAGS.indexOf('top50'));
});

test('a single-event report takes its event from the caller', () => {
  const row: ListIndexInputDeck = { player: 'A', placement: 12, archetype: 'Crustle', successTags: [], cards: [BOSS] };
  const index = buildListIndex([row], { id: 'labs:0042', name: 'Regional', date: '2026-09-13', players: 1840 });
  assert.deepEqual(index?.events, [['labs:0042', 'Regional', '2026-09-13', 1840]]);
  assert.equal(index?.decks[0]?.[4], 0);
});

test('a deck with no event at all points at none, and missing figures read as zero', () => {
  const index = buildListIndex([{ archetype: 'Crustle', cards: [BOSS], placement: null, country: null }]);
  assert.deepEqual(index?.events, []);
  assert.deepEqual(index?.decks[0], ['', '', 0, 0, -1, 0, [0, 3]]);
});
