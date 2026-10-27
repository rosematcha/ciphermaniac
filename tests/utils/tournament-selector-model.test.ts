import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RECENT_STANDARD_COUNT, selectorGroups } from '../../src/components/tournamentSelector/model';
import { ONLINE_META_LABEL, ONLINE_META_NAME } from '../../src/lib/constants';
import type { FormatsIndexEntry } from '../../shared/formats/registry';

const EVENTS = [
  '2026-05-16, Regional Championship Stuttgart',
  '2026-06-12, International Championship New Orleans',
  '2026-04-25, Regional Championship Melbourne',
  '2026-05-30, Regional Championship Milwaukee',
  '2026-05-02, Regional Championship Monterrey',
  '2026-05-23, Special Event Bologna'
];
const KEYS = [ONLINE_META_NAME, ...EVENTS];
const format = (id: string, label: string): FormatsIndexEntry => ({
  id,
  label,
  window: 'last 60 days',
  events: 1,
  decks: 4,
  windowStart: '2026-08-28T00:00:00.000Z',
  windowEnd: '2026-10-27T00:00:00.000Z'
});
const FORMATS = [format('expanded', 'Expanded'), format('rspk', 'RS-PK'), format('eternal', 'Eternal')];
const label = (key: string) => (key === ONLINE_META_NAME ? ONLINE_META_LABEL : key.slice(12));

test('the collapsed list shows the online meta and the newest Standard events', () => {
  const groups = selectorGroups({ keys: KEYS, formats: FORMATS, query: '', expanded: false, label });
  assert.equal(groups.online, true);
  assert.equal(groups.standard.length, RECENT_STANDARD_COUNT);
  assert.equal(groups.standard[0], '2026-06-12, International Championship New Orleans');
  assert.ok(!groups.standard.includes('2026-04-25, Regional Championship Melbourne'));
  assert.equal(groups.hasMore, true);
});

test('More reveals every Standard event, newest first', () => {
  const groups = selectorGroups({ keys: KEYS, formats: FORMATS, query: '', expanded: true, label });
  assert.deepEqual(
    groups.standard,
    [...EVENTS].sort((a, b) => b.localeCompare(a))
  );
  assert.equal(groups.hasMore, false);
});

test('a short list never offers More', () => {
  const groups = selectorGroups({
    keys: KEYS.slice(0, RECENT_STANDARD_COUNT + 1),
    formats: [],
    query: '',
    expanded: false,
    label
  });
  assert.equal(groups.standard.length, RECENT_STANDARD_COUNT);
  assert.equal(groups.hasMore, false);
});

test('search covers events past the first five and drops the cap', () => {
  const groups = selectorGroups({ keys: KEYS, formats: FORMATS, query: 'melbourne', expanded: false, label });
  assert.equal(groups.online, false);
  assert.deepEqual(groups.standard, ['2026-04-25, Regional Championship Melbourne']);
  assert.equal(groups.hasMore, false);
});

test('search matches display labels and folds accents and case', () => {
  assert.equal(
    selectorGroups({ keys: KEYS, formats: FORMATS, query: 'ONLINE EVENTS', expanded: false, label }).online,
    true
  );
  const accented = selectorGroups({
    keys: ['2026-03-01, Regional Championship Bogotá'],
    formats: [],
    query: 'bogota',
    expanded: false,
    label: k => k
  });
  assert.deepEqual(accented.standard, ['2026-03-01, Regional Championship Bogotá']);
});

test('no match leaves every group empty', () => {
  const groups = selectorGroups({ keys: KEYS, formats: FORMATS, query: 'zzz', expanded: false, label });
  assert.deepEqual(groups, { online: false, standard: [], hasMore: false, other: [] });
});

test('every published format sits in the Other group, in registry order', () => {
  const groups = selectorGroups({ keys: KEYS, formats: FORMATS, query: '', expanded: false, label });
  assert.deepEqual(
    groups.other.map(entry => entry.id),
    ['expanded', 'rspk', 'eternal']
  );
});

test('search finds a format by label or id, and no format when nothing published', () => {
  const byLabel = selectorGroups({ keys: KEYS, formats: FORMATS, query: 'rs-pk', expanded: false, label });
  assert.deepEqual(
    byLabel.other.map(entry => entry.id),
    ['rspk']
  );
  assert.deepEqual(byLabel.standard, []);
  const none = selectorGroups({ keys: KEYS, formats: [], query: '', expanded: false, label });
  assert.deepEqual(none.other, []);
});
