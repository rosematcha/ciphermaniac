/**
 * The archetype page's Lists tab: odd-slot marking against the archetype's own
 * bar, same-60 folding, tech candidates, filters, and the majors window.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { ListCard, ListRecord } from '../../src/lib/data/lists.ts';
import {
  type ArchetypeList,
  collapseSame60,
  filterLists,
  isBasicEnergy,
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
