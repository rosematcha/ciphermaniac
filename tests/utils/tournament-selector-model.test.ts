import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RECENT_STANDARD_COUNT, selectorGroups } from '../../src/components/tournamentSelector/model';
import { ONLINE_META_LABEL, ONLINE_META_NAME } from '../../src/lib/constants';

const EVENTS = [
  '2026-05-16, Regional Championship Stuttgart',
  '2026-06-12, International Championship New Orleans',
  '2026-04-25, Regional Championship Melbourne',
  '2026-05-30, Regional Championship Milwaukee',
  '2026-05-02, Regional Championship Monterrey',
  '2026-05-23, Special Event Bologna'
];
const KEYS = [ONLINE_META_NAME, ...EVENTS];
const label = (key: string) => (key === ONLINE_META_NAME ? ONLINE_META_LABEL : key.slice(12));

test('the collapsed list shows the online meta and the newest Standard events', () => {
  const groups = selectorGroups(KEYS, '', false, label);
  assert.equal(groups.online, true);
  assert.equal(groups.standard.length, RECENT_STANDARD_COUNT);
  assert.equal(groups.standard[0], '2026-06-12, International Championship New Orleans');
  assert.ok(!groups.standard.includes('2026-04-25, Regional Championship Melbourne'));
  assert.equal(groups.hasMore, true);
});

test('More reveals every Standard event, newest first', () => {
  const groups = selectorGroups(KEYS, '', true, label);
  assert.deepEqual(
    groups.standard,
    [...EVENTS].sort((a, b) => b.localeCompare(a))
  );
  assert.equal(groups.hasMore, false);
});

test('a short list never offers More', () => {
  const groups = selectorGroups(KEYS.slice(0, RECENT_STANDARD_COUNT + 1), '', false, label);
  assert.equal(groups.standard.length, RECENT_STANDARD_COUNT);
  assert.equal(groups.hasMore, false);
});

test('search covers events past the first five and drops the cap', () => {
  const groups = selectorGroups(KEYS, 'melbourne', false, label);
  assert.equal(groups.online, false);
  assert.deepEqual(groups.standard, ['2026-04-25, Regional Championship Melbourne']);
  assert.equal(groups.hasMore, false);
});

test('search matches display labels and folds accents and case', () => {
  assert.equal(selectorGroups(KEYS, 'ONLINE EVENTS', false, label).online, true);
  const accented = selectorGroups(['2026-03-01, Regional Championship Bogotá'], 'bogota', false, k => k);
  assert.deepEqual(accented.standard, ['2026-03-01, Regional Championship Bogotá']);
});

test('no match leaves every group empty', () => {
  const groups = selectorGroups(KEYS, 'zzz', false, label);
  assert.deepEqual(groups, { online: false, standard: [], hasMore: false });
});
