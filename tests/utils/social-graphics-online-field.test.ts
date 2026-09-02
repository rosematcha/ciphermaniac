/**
 * The online side of the Fraudulent graphic — how the ladder's own decks
 * finished with each card.
 *
 * The artifact is canonicalized when the cron runs, so the only thing worth
 * pinning here is that a synonym update since then cannot unjoin a card from
 * the master rows it is measured against.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildOnlineField, onlineFieldRate } from '../../src/pages/socialGraphics/onlineField.ts';
import type { CardSuccessIndex } from '../../shared/data/reports/cardSuccess.ts';
import type { SynonymDatabase } from '../../shared/data/cardIdentity.ts';

function index(cards: Record<string, [decks: number, success: number]>): CardSuccessIndex {
  return {
    tag: 'top25',
    minPlayers: 12,
    deckTotal: 9804,
    successTotal: 2460,
    cards: Object.fromEntries(Object.entries(cards).map(([uid, [decks, success]]) => [uid, { decks, success }]))
  };
}

test('the field carries the counts and the tag it counted', () => {
  const field = buildOnlineField(index({ 'Switch::MEG::130': [2673, 640] }), null);
  assert.equal(field.tag, 'top25');
  assert.deepEqual(field.cards.get('Switch::MEG::130'), { decks: 2673, success: 640 });
  assert.equal(Math.round(onlineFieldRate(field)), 25);
});

test('a synonym update since the cron ran cannot unjoin a card', () => {
  const db = { synonyms: { 'Switch::SVI::194': 'Switch::MEG::130' }, canonicals: {} } as SynonymDatabase;
  const field = buildOnlineField(index({ 'Switch::MEG::130': [2000, 500], 'Switch::SVI::194': [673, 140] }), db);
  assert.deepEqual(field.cards.get('Switch::MEG::130'), { decks: 2673, success: 640 });
  assert.equal(field.cards.size, 1);
});

test('an empty window has no rate to read a card against', () => {
  const field = buildOnlineField({ ...index({}), deckTotal: 0, successTotal: 0 }, null);
  assert.equal(onlineFieldRate(field), 0);
});
