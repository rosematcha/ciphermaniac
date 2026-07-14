/**
 * tests/data/labs-source-adapter.test.ts
 * Labs source -> normalized adapter: output validates and applies all policy.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { type LabsSourceEvent, labsSourceToNormalized } from '../../shared/data/adapters/labsSource.ts';
import { canonicalStringify } from '../../shared/data/canonicalJson.ts';
import { validateNormalizedEvent } from '../../shared/data/contracts.ts';
import { buildEventArtifacts } from '../../shared/data/reports/eventArtifacts.ts';

function source(): LabsSourceEvent {
  return {
    labsCode: '0042',
    fetchedAt: '2026-07-13T00:00:00.000Z',
    meta: { name: 'Test Regional', date: '2026-07-01', players: 8, division: 'MA', hasDay2: true, country: 'US' },
    standings: [
      { tpId: 1, playerId: 'p-alice', name: 'Alice', country: 'US', placement: 1, wins: 5, losses: 1, ties: 0, points: 15, opw: 0.62, oopw: 0.58, madePhase2: true, madeTopCut: true, decklistPublished: true, deckName: 'Gardevoir ex' },
      { tpId: 2, playerId: 'p-bob', name: 'Bob', country: 'CA', placement: 2, wins: 5, losses: 1, ties: 0, points: 15, opw: 0.55, madePhase2: true, madeTopCut: true, decklistPublished: true, deckName: 'gardevoir EX' },
      { tpId: 3, name: 'Cara', placement: 3, wins: 4, losses: 2, ties: 0, madePhase2: true, deckName: 'Charizard Pidgeot', dropped: true, dropRound: 7 },
      { tpId: 4, name: 'Dan', placement: 4, wins: 3, losses: 3, ties: 0, deckName: 'Charizard Pidgeot' }
    ],
    decklists: {
      '1': [
        { name: 'Gardevoir ex', set: 'SVI', number: '86', count: 3, category: 'pokemon' },
        // two printings of one canonical card in one deck -> counted once
        { name: 'Rare Candy', set: 'SVI', number: '191', count: 2, category: 'trainer', trainerType: 'item' },
        { name: 'Rare Candy', set: 'PAL', number: '256', count: 2, category: 'trainer', trainerType: 'item' },
        { name: 'Basic Darkness Energy', count: 6, category: 'energy', energyType: 'basic' }
      ],
      '2': [{ name: 'Gardevoir ex', set: 'svi', number: '86', count: 4, category: 'pokemon' }],
      '3': [{ name: 'Charizard ex', set: 'OBF', number: '125', count: 3, category: 'pokemon' }],
      '4': [{ name: 'Pidgeot ex', set: 'OBF', number: '164', count: 2, category: 'pokemon' }]
    },
    matches: [
      { round: 1, phase: 1, table: 1, completed: true, p1Id: 1, p2Id: 2, winner: 1 },
      { round: 1, phase: 1, table: 2, completed: true, p1Id: 3, p2Id: 4, winner: 0 },
      { round: 2, phase: 2, table: 1, completed: true, p1Id: 1, p2Id: 2, winner: -1 },
      { round: 2, phase: 2, completed: true, p1Id: 3, winner: 3 }
    ]
  };
}

test('adapter output passes the contract validator', () => {
  const event = labsSourceToNormalized(source());
  const result = validateNormalizedEvent(event);
  assert.deepStrictEqual(result.ok ? [] : result.errors, []);
});

test('opw fraction is converted to a 0-100 percentage', () => {
  const event = labsSourceToNormalized(source());
  const alice = event.participants.find(p => p.name === 'Alice');
  assert.strictEqual(alice?.opwPct, 62);
});

test('two synonym printings of one card in a deck count once', () => {
  // With a synonym mapping PAL 256 -> SVI 191, both printings resolve to one
  // canonical card and are counted a single time (found <= deckTotal invariant).
  const synonymDb = { synonyms: { 'Rare Candy::PAL::256': 'Rare Candy::SVI::191' }, canonicals: {} };
  const event = labsSourceToNormalized(source(), { synonymDb });
  assert.ok(validateNormalizedEvent(event).ok);
  const aliceDeck = event.decks.find(d => event.participants.find(p => p.participantId === d.participantId)?.name === 'Alice');
  assert.ok(aliceDeck);
  const rareCandy = aliceDeck.cards.filter(c => c.canonical.name === 'Rare Candy');
  assert.strictEqual(rareCandy.length, 1, 'one canonical Rare Candy entry');
  assert.strictEqual(rareCandy[0].count, 4); // 2 + 2 collapsed
  assert.strictEqual(rareCandy[0].printings.length, 2); // both source printings retained
});

test('dropRound is kept only when dropped', () => {
  const event = labsSourceToNormalized(source());
  const cara = event.participants.find(p => p.name === 'Cara');
  const dan = event.participants.find(p => p.name === 'Dan');
  assert.strictEqual(cara?.dropRound, 7);
  assert.strictEqual(dan?.dropRound, null);
});

test('match outcomes derive from raw Labs winner codes', () => {
  const event = labsSourceToNormalized(source());
  const outcomes = event.matches.map(m => m.outcome).sort();
  assert.deepStrictEqual(outcomes, ['bye', 'decided', 'double_loss', 'tie']);
  const decided = event.matches.find(m => m.outcome === 'decided');
  assert.ok(decided?.winnerParticipantId);
});

test('success tags include phase tags for a Labs event', () => {
  const event = labsSourceToNormalized(source());
  const winnerDeck = event.decks.find(d => event.participants.find(p => p.participantId === d.participantId)?.placement === 1);
  assert.ok(winnerDeck?.successTags.includes('winner'));
  assert.ok(winnerDeck?.successTags.includes('topcut'));
});

test('the adapter output drives the artifact orchestrator end to end', () => {
  const event = labsSourceToNormalized(source());
  const artifacts = buildEventArtifacts(event);
  assert.ok(artifacts.has('master.json'));
  assert.ok(artifacts.has('matchupProfiles.json'));
  // Gardevoir mirror (Alice vs Bob, same key) is present in the matchup profiles.
  const mp = artifacts.get('matchupProfiles.json') as { profiles: { all: { byArchetypePair: { archetypeA: string; archetypeB: string }[] } } };
  assert.ok(mp.profiles.all.byArchetypePair.some(p => p.archetypeA === p.archetypeB));
});

test('deterministic: same source builds byte-identical normalized output twice', () => {
  assert.strictEqual(canonicalStringify(labsSourceToNormalized(source())), canonicalStringify(labsSourceToNormalized(source())));
});
