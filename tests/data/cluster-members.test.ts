/**
 * tests/data/cluster-members.test.ts
 * getClusterMembers + parseCardUid: browser-safe cluster recovery from the
 * flat synonyms map, for the card page's Printings section.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { getClusterMembers, parseCardUid, type SynonymDatabase } from '../../shared/data/cardIdentity.ts';

const DB: SynonymDatabase = {
  synonyms: {
    'Night Stretcher::SSP::251': 'Night Stretcher::SFA::061',
    'Night Stretcher::MEG::173': 'Night Stretcher::SFA::061',
    'Night Stretcher::ASC::196': 'Night Stretcher::SFA::061',
    'Rare Candy::SVI::191': 'Rare Candy::MEG::125'
  },
  canonicals: {
    'Night Stretcher': 'Night Stretcher::SFA::061'
  },
  prints: {
    'Night Stretcher::SFA::061': 0.27,
    'Night Stretcher::ASC::196': null
  }
};

test('returns the full cluster, canonical first, from a canonical UID', () => {
  const members = getClusterMembers(DB, 'Night Stretcher::SFA::061');
  assert.strictEqual(members[0], 'Night Stretcher::SFA::061');
  assert.deepStrictEqual(
    new Set(members),
    new Set([
      'Night Stretcher::SFA::061',
      'Night Stretcher::SSP::251',
      'Night Stretcher::MEG::173',
      'Night Stretcher::ASC::196'
    ])
  );
});

test('resolves a variant UID or a bare name to the same cluster', () => {
  const fromVariant = getClusterMembers(DB, 'Night Stretcher::ASC::196');
  const fromName = getClusterMembers(DB, 'Night Stretcher');
  assert.deepStrictEqual(fromVariant, fromName);
  assert.strictEqual(fromVariant[0], 'Night Stretcher::SFA::061');
  assert.strictEqual(fromVariant.length, 4);
});

test('a UID with no synonym entries is its own one-member cluster', () => {
  assert.deepStrictEqual(getClusterMembers(DB, 'Ultra Ball::SVI::196'), ['Ultra Ball::SVI::196']);
});

test('null database degrades to a one-member cluster', () => {
  assert.deepStrictEqual(getClusterMembers(null, 'Night Stretcher::SFA::061'), ['Night Stretcher::SFA::061']);
});

test('parseCardUid splits from the right and rejects malformed UIDs', () => {
  assert.deepStrictEqual(parseCardUid('Night Stretcher::SFA::061'), {
    name: 'Night Stretcher',
    set: 'SFA',
    number: '061'
  });
  // A pathological name containing '::' cannot shift the set/number fields.
  assert.deepStrictEqual(parseCardUid('Weird::Name::SFA::061'), { name: 'Weird::Name', set: 'SFA', number: '061' });
  assert.strictEqual(parseCardUid('Night Stretcher'), null);
  assert.strictEqual(parseCardUid('A::B'), null);
});
