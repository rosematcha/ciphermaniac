import test from 'node:test';
import assert from 'node:assert/strict';

import {
  hasJapanOnlyCard,
  isJapanOnlySet,
  japaneseSetOf,
  japanOnlySetCode,
  jpCardImageKey,
  limitlessJpSetCandidates
} from '../../shared/data/japanOnlyCards';

test('Japanese prints get a JP- set code that no English code can collide with', () => {
  // Limitless files the Eevee ex starter set as MEE, like Mega Evolution Energies.
  assert.equal(japanOnlySetCode('MEE'), 'JP-MEE');
  assert.equal(japanOnlySetCode('M6a'), 'JP-M6A');
  assert.equal(isJapanOnlySet('JP-M6'), true);
  assert.equal(isJapanOnlySet('jp-m6'), true);
  assert.equal(isJapanOnlySet('MEE'), false);
  assert.equal(isJapanOnlySet('JTG'), false);
  assert.equal(isJapanOnlySet(null), false);
  assert.equal(japaneseSetOf('JP-M6A'), 'M6A');
});

test('Limitless spellings of a Japanese set code', () => {
  assert.deepEqual(limitlessJpSetCandidates('M6'), ['M6']);
  assert.deepEqual(limitlessJpSetCandidates('M6A'), ['M6A', 'M6a']);
  assert.deepEqual(limitlessJpSetCandidates('SV11B'), ['SV11B', 'SV11b']);
  assert.deepEqual(limitlessJpSetCandidates('MEE'), ['MEE']);
});

test('image keys pad the number and uppercase the set', () => {
  assert.equal(jpCardImageKey('M6', '62', 'XS'), 'jp-card-images/M6/M6_062_XS.webp');
  assert.equal(jpCardImageKey('M6', '062', 'XS'), 'jp-card-images/M6/M6_062_XS.webp');
  assert.equal(jpCardImageKey('MP', '151', 'LG'), 'jp-card-images/MP/MP_151_LG.webp');
});

test('a list holds a fan-translated card when any card has a JP- set', () => {
  assert.equal(hasJapanOnlyCard([{ set: 'MEG' }, { set: 'JP-M6' }]), true);
  assert.equal(hasJapanOnlyCard([{ set: 'MEG' }, { set: null }, {}]), false);
  assert.equal(hasJapanOnlyCard(null), false);
});
