/**
 * The per-card online finish index.
 *
 * The load-bearing decision is the eligibility floor: online fields run from
 * four players to a few hundred, and a deck from a pod too small to earn the
 * tag must not land in the denominator as a failure. Everything else mirrors
 * the conversion index — one count per canonical card per deck, bare-name cards
 * skipped.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCardSuccessIndex,
  SUCCESS_TAG,
  type SuccessDeck,
  type SuccessDeckCard,
  successMinPlayers
} from '../../shared/data/reports/cardSuccess.ts';

const SWITCH = { name: 'Switch', set: 'MEG', number: '130' };
const BOSS = { name: "Boss's Orders", set: 'MEG', number: '114' };

function deck(players: number, tags: string[], cards: SuccessDeckCard[] = [SWITCH]): SuccessDeck {
  return { tournamentPlayers: players, successTags: tags, cards };
}

test('the success tag and its floor come from the frozen policy', () => {
  assert.equal(SUCCESS_TAG, 'top25');
  assert.equal(successMinPlayers(), 12);
  assert.equal(successMinPlayers('top8'), 16);
  assert.equal(successMinPlayers('nonsense'), 0);
});

test('eligible decks are counted, and the tagged ones scored', () => {
  const index = buildCardSuccessIndex([deck(64, ['top25']), deck(64, []), deck(64, ['top25'])]);
  assert.equal(index?.deckTotal, 3);
  assert.equal(index?.successTotal, 2);
  assert.deepEqual(index?.cards['Switch::MEG::130'], { decks: 3, success: 2 });
});

test('a field too small for the tag stays out of the denominator', () => {
  // Four-player pods cannot earn top25, so counting their decks as failures
  // would read as the format punishing whatever they played.
  const index = buildCardSuccessIndex([deck(4, []), deck(8, []), deck(64, ['top25'])]);
  assert.equal(index?.deckTotal, 1);
  assert.equal(index?.successTotal, 1);
  assert.deepEqual(index?.cards['Switch::MEG::130'], { decks: 1, success: 1 });
});

test('a card is counted once per deck however many printings it lists', () => {
  const db = { synonyms: { 'Switch::SVI::194': 'Switch::MEG::130' }, canonicals: {} };
  const index = buildCardSuccessIndex(
    [deck(64, ['top25'], [SWITCH, { name: 'Switch', set: 'SVI', number: '194' }])],
    db
  );
  assert.deepEqual(index?.cards['Switch::MEG::130'], { decks: 1, success: 1 });
  assert.equal(Object.keys(index?.cards ?? {}).length, 1);
});

test('cards without a set and number are skipped', () => {
  const index = buildCardSuccessIndex([deck(64, ['top25'], [{ name: 'Darkness Energy' }, BOSS])]);
  assert.deepEqual(Object.keys(index?.cards ?? {}), ["Boss's Orders::MEG::114"]);
});

test('a window with nothing eligible produces no index at all', () => {
  assert.equal(buildCardSuccessIndex([deck(4, []), deck(8, [])]), null);
  assert.equal(buildCardSuccessIndex([]), null);
  assert.equal(buildCardSuccessIndex(null), null);
});

test('a deck with no player count is not assumed eligible', () => {
  assert.equal(buildCardSuccessIndex([{ successTags: ['top25'], cards: [SWITCH] }]), null);
});
