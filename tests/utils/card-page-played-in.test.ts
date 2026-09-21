/**
 * The card page's "Played in" block: decoding the list index, finding a card's
 * lists, and ranking archetypes with their best finishes.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { decodeListIndex, type ListRecord } from '../../src/lib/data/lists.ts';
import {
  buildPlayedInGroups,
  compareFinish,
  foldedCount,
  listsForCard,
  singleEvent
} from '../../src/pages/cardPage/playedInModel.ts';
import type { ArchetypeUsageRow } from '../../src/pages/cardPage/model.ts';
import type { ListIndexPayload } from '../../shared/data/reports/listIndex.ts';
import type { SynonymDatabase } from '../../shared/data/cardIdentity.ts';

const BOSS = "Boss's Orders::MEG::114";

const PAYLOAD: ListIndexPayload = {
  schemaVersion: 1,
  tags: ['winner', 'top2', 'top4', 'top8', 'top16', 'top10', 'top25', 'top50'],
  archetypes: ['Dragapult', 'Crustle'],
  events: [
    ['t1', 'Weekly', '2026-09-20', 142],
    ['t2', 'Cup', '2026-09-18', 40]
  ],
  cards: [
    ["Boss's Orders", 'MEG', '114', 'trainer'],
    ["Boss's Orders", 'PAL', '172', 'trainer'],
    ['Dreepy', 'TWM', '128', 'pokemon'],
    ['Fire Energy', '', '', 'energy']
  ],
  decks: [
    ['Mew', 'US', 1, 0, 0, 0b11111111, [2, 4, 0, 3]],
    ['Takumi', 'JP', 5, 0, 1, 0b11000000, [2, 4, 1, 2]],
    ['Ronald', 'BR', 2, 1, 0, 0b11111110, [0, 1, 1, 1]],
    ['Nobody', '', 0, 1, -1, 0, [3, 4]]
  ]
};

// The synonym DB collapses the PAL reprint onto the MEG print.
const DB = { synonyms: { "Boss's Orders::PAL::172": BOSS } } as unknown as SynonymDatabase;

const records = () => decodeListIndex(PAYLOAD, DB);

function row(
  name: string,
  found: number,
  pct: number,
  dist: { copies: number; players: number }[] = []
): ArchetypeUsageRow {
  return {
    entry: { name, label: name, deckCount: found, percent: null, thumbnails: [] },
    item: {
      name: BOSS,
      found,
      pct,
      dist: dist.map(d => ({ ...d, percent: (d.players / found) * 100 }))
    } as ArchetypeUsageRow['item'],
    report: { deckTotal: found }
  };
}

test('decoding restores names, events, tags and canonical uids', () => {
  const [mew, , ronald, nobody] = records();
  assert.equal(mew.player, 'Mew');
  assert.deepEqual(mew.event, { id: 't1', name: 'Weekly', date: '2026-09-20', players: 142 });
  assert.ok(mew.tags.has('winner') && mew.tags.has('top50'));
  assert.equal(mew.cards[1].uid, BOSS);
  assert.equal(ronald.cards[1].uid, BOSS, 'the reprint resolves to the canonical uid');
  assert.equal(nobody.event, null);
  assert.equal(nobody.cards[0].uid, '', 'a bare-name card has no uid');
});

test("a card's lists come with the copies they run, across printings", () => {
  const lists = listsForCard(records(), BOSS);
  assert.deepEqual(
    lists.map(l => [l.record.player, l.copies]),
    [
      ['Mew', 3],
      ['Takumi', 2],
      ['Ronald', 2]
    ]
  );
  assert.deepEqual(listsForCard(records(), null), []);
});

test('best finish first: placement, then field size, then date; unplaced last', () => {
  const at = (placement: number, players: number, date = ''): ListRecord =>
    ({
      placement,
      event: { id: '', name: '', date, players },
      tags: new Set(),
      cards: [],
      uids: new Set()
    }) as unknown as ListRecord;
  assert.ok(compareFinish(at(1, 10), at(2, 500)) < 0);
  assert.ok(compareFinish(at(1, 500), at(1, 10)) < 0);
  assert.ok(compareFinish(at(1, 10, '2026-09-20'), at(1, 10, '2026-09-10')) < 0);
  assert.ok(compareFinish(at(0, 999), at(64, 8)) > 0);
});

test('groups rank by lists in the finish tier, carry the usage split, and drop archetypes with none', () => {
  const rows = [
    row('Crustle', 300, 100, [
      { copies: 2, players: 250 },
      { copies: 3, players: 50 }
    ]),
    row('Dragapult', 900, 100)
  ];
  const all = buildPlayedInGroups(rows, listsForCard(records(), BOSS), 'all');
  assert.deepEqual(
    all.map(g => [g.usage.entry.name, g.lists.map(l => l.record.player)]),
    [
      ['Dragapult', ['Mew', 'Takumi']],
      ['Crustle', ['Ronald']]
    ]
  );
  assert.equal(all[1].modal?.copies, 2);

  const winners = buildPlayedInGroups(rows, listsForCard(records(), BOSS), 'winner');
  assert.deepEqual(
    winners.map(g => [g.usage.entry.name, g.lists.length]),
    [['Dragapult', 1]]
  );
});

test('without an index, groups rank by decks running the card and keep every archetype', () => {
  const groups = buildPlayedInGroups([row('Crustle', 300, 100), row('Dragapult', 900, 100)], null, 'all');
  assert.deepEqual(
    groups.map(g => g.usage.entry.name),
    ['Dragapult', 'Crustle']
  );
  assert.deepEqual(groups[0].lists, []);
});

test('the fold shows six and only hides five or more', () => {
  assert.equal(foldedCount(6), 6);
  assert.equal(foldedCount(10), 10);
  assert.equal(foldedCount(11), 6);
  assert.equal(foldedCount(35), 6);
});

test('a single-event report is detected so rows can drop the event column', () => {
  const all = records();
  assert.equal(singleEvent(all), false);
  assert.equal(singleEvent(all.filter(r => r.event?.id === 't1')), true);
  assert.equal(singleEvent([]), true);
});
