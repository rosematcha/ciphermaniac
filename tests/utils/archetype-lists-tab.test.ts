/**
 * The archetype page's Lists tab: odd-slot marking against the archetype's own
 * bar, same-60 folding, tech candidates, filters, and the majors window.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { decodeListIndex, type ListCard, type ListRecord } from '../../src/lib/data/lists.ts';
import { EMPTY_DATABASE, type SynonymDatabase } from '../../shared/data/cardIdentity.ts';
import type { ListIndexPayload } from '../../shared/data/reports/listIndex.ts';
import {
  type ArchetypeList,
  collapseSame60,
  filterLists,
  isBasicEnergy,
  mergedCards,
  oddSlots,
  slotStats,
  techCandidates
} from '../../src/pages/archetypePage/listsModel.ts';
import { recentMajors } from '../../src/pages/archetypePage/loadLists.ts';

const card = (name: string, count: number, set = 'TWM', number = '1'): ListCard => ({
  name,
  count,
  set,
  number,
  category: 'trainer',
  uid: ''
});

let seq = 0;
function list(
  cards: ListCard[],
  opts: { placement?: number; players?: number; tags?: string[]; venue?: 'online' | 'live' } = {}
): ArchetypeList {
  seq += 1;
  const record: ListRecord = {
    id: seq,
    player: `P${seq}`,
    country: '',
    placement: opts.placement ?? seq,
    archetype: 'Dragapult',
    event: { id: 'e', name: 'Weekly', date: '2026-09-20', players: opts.players ?? 100 },
    tags: new Set(opts.tags ?? []),
    cards,
    uids: new Set()
  };
  return { key: `0:${seq}`, record, venue: opts.venue ?? 'online' };
}

const stock = () => [card('Boss', 3), card('Poffin', 4), card('Psychic Energy', 3)];

test('a stock list marks nothing and an odd count is marked', () => {
  const lists = Array.from({ length: 9 }, () => list(stock()));
  const odd = list([card('Boss', 1), card('Poffin', 4), card('Psychic Energy', 7)]);
  lists.push(odd);
  const stats = slotStats(lists);
  assert.deepEqual(oddSlots(lists[0].record, stats), []);
  const marked = oddSlots(odd.record, stats).map(s => `${s.card.count} ${s.card.name}`);
  assert.deepEqual(marked, ['1 Boss'], 'basic energy never marks, the 1-of Boss does');
});

test('the bar follows how concentrated the archetype is', () => {
  const tight = Array.from({ length: 20 }, () => list(stock()));
  const loose = Array.from({ length: 20 }, (_, i) => list([card(`Tech ${i}`, 1), card('Boss', (i % 4) + 1)]));
  assert.ok(slotStats(tight).bar > slotStats(loose).bar);
  assert.equal(slotStats([]).bar, 60);
});

test('identical 60s fold under their best finish', () => {
  const a = list(stock(), { placement: 9 });
  const b = list(stock(), { placement: 2 });
  const c = list([card('Boss', 2)], { placement: 1 });
  const groups = collapseSame60([a, b, c]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].face, c);
  assert.equal(groups[1].face, b);
  assert.deepEqual(groups[1].others, [a]);
});

test('tech candidates skip staples, basics and bare-name cards', () => {
  const lists = Array.from({ length: 10 }, (_, i) =>
    list([
      card('Boss', 3),
      card('Psychic Energy', 3),
      ...(i < 3 ? [card('Judge', 1)] : []),
      ...(i < 2 ? [card('Bare', 1, '', '')] : [])
    ])
  );
  assert.deepEqual(
    techCandidates(lists).map(t => t.name),
    ['Judge']
  );
  assert.ok(isBasicEnergy('Basic Fire Energy') && !isBasicEnergy('Telepathic Psychic Energy'));
});

test('filters combine finish, venue and techs', () => {
  const lists = [
    list([card('Judge', 1)], { tags: ['top8'], venue: 'live' }),
    list([card('Judge', 1)], { tags: [], venue: 'online' }),
    list([card('Boss', 1)], { tags: ['top8'], venue: 'online' })
  ];
  const run = (finish: string, venue: 'all' | 'live' | 'online', techs: string[]) =>
    filterLists(lists, { finish, venue, techs: new Set(techs) }).length;
  assert.equal(run('all', 'all', []), 3);
  assert.equal(run('top8', 'all', []), 2);
  assert.equal(run('all', 'online', ['Judge']), 1);
  assert.equal(run('top8', 'live', ['Boss']), 0);
});

test('recent majors are dated folders inside the window, never the online key', () => {
  const now = Date.parse('2026-09-22T12:00:00Z');
  const keys = [
    'Online - Last 14 Days',
    '2026-09-18, Regional Championship Baltimore',
    '2026-08-28, World Championship San Francisco',
    '2026-08-01, Regional Championship Old',
    '2026-10-01, Regional Championship Future'
  ];
  assert.deepEqual(recentMajors(keys, now), [
    '2026-09-18, Regional Championship Baltimore',
    '2026-08-28, World Championship San Francisco'
  ]);
});

test('printings of one card count as one slot', () => {
  const split = [card('Iono', 2, 'PAL', '185'), card('Iono', 2, 'PAF', '80')];
  const lists = Array.from({ length: 10 }, () => list([card('Iono', 4, 'PAL', '185')]));
  lists.push(list(split));
  const stats = slotStats(lists);
  assert.equal(stats.pairShare('Iono', 4), 100);
  assert.deepEqual(oddSlots(lists[10].record, stats), []);
  assert.equal(collapseSame60(lists).length, 1);
});

test('same-name cards with distinct canonical identities stay separate', () => {
  const a = { ...card('Pikachu', 2), uid: 'pikachu-a' };
  const b = { ...card('Pikachu', 2), uid: 'pikachu-b' };
  assert.equal(mergedCards(list([a, b]).record).length, 2);
  assert.equal(collapseSame60([list([a]), list([b])]).length, 2);
  assert.equal(collapseSame60([list([a, b]), list([{ ...a, count: 4 }])]).length, 2);
});

test('canonical reprints merge regardless of printing or display name and card order', () => {
  const a = { ...card('Iono', 2, 'PAL', '185'), uid: 'iono' };
  const b = { ...card('Iono reprint', 2, 'PAF', '80'), uid: 'iono' };
  const energy = card('Psychic Energy', 56);
  assert.deepEqual(mergedCards(list([a, b]).record), [{ ...a, count: 4 }]);
  assert.equal(collapseSame60([list([a, energy, b]), list([energy, { ...b, count: 4 }])]).length, 1);
});

test('same-name canonical slots have independent shares and odd-slot scores', () => {
  const a = { ...card('Goldeen', 3), uid: 'goldeen-a' };
  const b = { ...card('Goldeen', 1), uid: 'goldeen-b' };
  const lists = Array.from({ length: 9 }, () => list([a]));
  const both = list([a, b]);
  lists.push(both);
  const stats = slotStats(lists);
  assert.equal(stats.nameShare(a.uid), 100);
  assert.equal(stats.nameShare(b.uid), 10);
  assert.equal(stats.pairShare(a.uid, 3), 100);
  assert.equal(stats.pairShare(b.uid, 1), 10);
  assert.equal(stats.pairShare(a.uid, 1), 0);
  assert.equal(stats.pairShare(b.uid, 3), 0);
  assert.deepEqual(oddSlots(both.record, stats), [{ card: b, share: 10 }]);
  const equalCounts = slotStats([list([a, { ...b, count: 3 }])]);
  assert.equal(equalCounts.pairShare(a.uid, 3), 100);
  assert.equal(equalCounts.pairShare(b.uid, 3), 100);
});

const REPRINT_PAYLOAD: ListIndexPayload = {
  schemaVersion: 1,
  tags: [],
  archetypes: ['Dragapult'],
  events: [],
  cards: [
    ['Iono', 'PAL', '185', 'trainer'],
    ['Iono', 'PAF', '80', 'trainer']
  ],
  decks: [
    ['A', '', 1, 0, -1, 0, [0, 2, 1, 2]],
    ['B', '', 2, 0, -1, 0, [1, 4]]
  ]
};

function reprintLists(db: SynonymDatabase | null): ArchetypeList[] {
  return decodeListIndex(REPRINT_PAYLOAD, db).map(record => ({ key: String(record.id), record, venue: 'online' }));
}

[null, EMPTY_DATABASE].forEach(db => {
  test(`reprints fold by name when the synonym database is ${db ? 'empty' : 'missing'}`, () => {
    const lists = reprintLists(db);
    assert.notEqual(lists[0].record.cards[0].uid, lists[0].record.cards[1].uid, 'raw lookup UIDs remain intact');
    assert.equal(mergedCards(lists[0].record).length, 1);
    assert.equal(mergedCards(lists[0].record)[0].count, 4);
    assert.equal(collapseSame60(lists).length, 1);
    const stats = slotStats(lists);
    assert.equal(stats.nameShare('Iono'), 100);
    assert.equal(stats.pairShare('Iono', 4), 100);
    assert.deepEqual(oddSlots(lists[0].record, stats), []);
  });
});

test('a canonical UID matching its raw printing stays canonical with a populated database', () => {
  const uid = 'Iono::PAL::185';
  const lists = reprintLists({ synonyms: { 'Iono::PAF::080': uid }, canonicals: {} });
  assert.equal(collapseSame60(lists).length, 1);
  assert.equal(slotStats(lists).nameShare(uid), 100);
  assert.equal(slotStats(lists).pairShare(uid, 4), 100);
});
