import test from 'node:test';
import assert from 'node:assert/strict';

import { canonicalizeReport } from '../../src/lib/data.ts';
import type { SynonymDatabase } from '../../shared/synonyms.ts';
import type { CardItem } from '../../src/types';

/**
 * Read-time canonicalization tests.
 *
 * `canonicalizeReport` is the "symlink" layer: stored reports keep variant
 * entries, but the data layer merges them into the canonical row at read.
 * These tests cover the merge, the no-op case, the dist-bucket math, and
 * (critically) that same-name-different-card pairs never accidentally merge.
 */

function makeItem(partial: Partial<CardItem> & { name: string; found: number; total: number }): CardItem {
  return {
    pct: 0,
    ...partial
  };
}

test('canonicalizeReport: merges variant printings into the canonical row', () => {
  const db: SynonymDatabase = {
    synonyms: {
      "Team Rocket's Watchtower::ASC::210": "Team Rocket's Watchtower::DRI::180"
    },
    canonicals: {
      "Team Rocket's Watchtower": "Team Rocket's Watchtower::DRI::180"
    }
  };

  const report = {
    deckTotal: 100,
    items: [
      makeItem({
        name: "Team Rocket's Watchtower",
        set: 'DRI',
        number: '180',
        uid: "Team Rocket's Watchtower::DRI::180",
        found: 30,
        total: 100
      }),
      makeItem({
        name: "Team Rocket's Watchtower",
        set: 'ASC',
        number: '210',
        uid: "Team Rocket's Watchtower::ASC::210",
        found: 12,
        total: 100
      })
    ]
  };

  const result = canonicalizeReport(report, db);

  assert.equal(result.items.length, 1, 'variant should collapse into one row');
  const merged = result.items[0];
  assert.equal(merged.uid, "Team Rocket's Watchtower::DRI::180");
  assert.equal(merged.set, 'DRI');
  assert.equal(merged.number, '180');
  assert.equal(merged.found, 42, 'found = 30 + 12');
  assert.equal(merged.pct, 42, 'pct = (42/100)*100 = 42');
  assert.equal(merged.rank, 1);
});

test('canonicalizeReport: leaves non-synonym cards alone', () => {
  const db: SynonymDatabase = { synonyms: {}, canonicals: {} };
  const report = {
    deckTotal: 50,
    items: [
      makeItem({ name: 'Iono', set: 'PAL', number: '185', uid: 'Iono::PAL::185', found: 20, total: 50, pct: 40 }),
      makeItem({ name: 'Boss', set: 'MEG', number: '114', uid: 'Boss::MEG::114', found: 10, total: 50, pct: 20 })
    ]
  };

  const result = canonicalizeReport(report, db);
  assert.equal(result.items.length, 2, 'no merges should happen');
  assert.equal(result.items[0].uid, 'Iono::PAL::185');
  assert.equal(result.items[1].uid, 'Boss::MEG::114');
});

test('canonicalizeReport: merges dist buckets by copies and recomputes percent', () => {
  const db: SynonymDatabase = {
    synonyms: { 'Foo::B::002': 'Foo::A::001' },
    canonicals: { Foo: 'Foo::A::001' }
  };

  const report = {
    deckTotal: 100,
    items: [
      makeItem({
        name: 'Foo',
        set: 'A',
        number: '001',
        uid: 'Foo::A::001',
        found: 10,
        total: 100,
        dist: [
          { copies: 1, players: 4, percent: 40 },
          { copies: 2, players: 6, percent: 60 }
        ]
      }),
      makeItem({
        name: 'Foo',
        set: 'B',
        number: '002',
        uid: 'Foo::B::002',
        found: 10,
        total: 100,
        dist: [
          { copies: 1, players: 6, percent: 60 },
          { copies: 3, players: 4, percent: 40 }
        ]
      })
    ]
  };

  const result = canonicalizeReport(report, db);
  assert.equal(result.items.length, 1);
  const merged = result.items[0];
  assert.equal(merged.found, 20);

  // dist buckets: copies 1 = 4+6 = 10, copies 2 = 6, copies 3 = 4
  const distByCopies = new Map(merged.dist!.map(d => [d.copies, d]));
  assert.equal(distByCopies.get(1)?.players, 10);
  assert.equal(distByCopies.get(2)?.players, 6);
  assert.equal(distByCopies.get(3)?.players, 4);
  // Each bucket's percent = (players / merged.found) * 100
  assert.equal(distByCopies.get(1)?.percent, 50);
  assert.equal(distByCopies.get(2)?.percent, 30);
  assert.equal(distByCopies.get(3)?.percent, 20);
});

test('canonicalizeReport: same-name different-card pairs are NOT merged without an explicit synonym', () => {
  // Ralts PAF 027 and Ralts MEG 058 are different cards (different abilities)
  // and the synonym DB must not contain a mapping between them. Verify the
  // canonicalizer treats them as separate rows.
  const db: SynonymDatabase = { synonyms: {}, canonicals: {} };

  const report = {
    deckTotal: 100,
    items: [
      makeItem({ name: 'Ralts', set: 'PAF', number: '027', uid: 'Ralts::PAF::027', found: 8, total: 100 }),
      makeItem({ name: 'Ralts', set: 'MEG', number: '058', uid: 'Ralts::MEG::058', found: 14, total: 100 })
    ]
  };

  const result = canonicalizeReport(report, db);
  assert.equal(result.items.length, 2, 'no merge — different cards with the same name');
  const uids = new Set(result.items.map(i => i.uid));
  assert.ok(uids.has('Ralts::PAF::027'));
  assert.ok(uids.has('Ralts::MEG::058'));
});

test('canonicalizeReport: re-sorts by found descending and reassigns rank', () => {
  const db: SynonymDatabase = { synonyms: {}, canonicals: {} };
  const report = {
    deckTotal: 100,
    items: [
      makeItem({ name: 'Low', set: 'X', number: '1', uid: 'Low::X::1', found: 5, total: 100, rank: 1 }),
      makeItem({ name: 'High', set: 'X', number: '2', uid: 'High::X::2', found: 50, total: 100, rank: 2 }),
      makeItem({ name: 'Mid', set: 'X', number: '3', uid: 'Mid::X::3', found: 20, total: 100, rank: 3 })
    ]
  };
  const result = canonicalizeReport(report, db);
  assert.equal(result.items[0].name, 'High');
  assert.equal(result.items[0].rank, 1);
  assert.equal(result.items[1].name, 'Mid');
  assert.equal(result.items[1].rank, 2);
  assert.equal(result.items[2].name, 'Low');
  assert.equal(result.items[2].rank, 3);
});

test('canonicalizeReport: null/empty db is a no-op', () => {
  const report = {
    deckTotal: 10,
    items: [makeItem({ name: 'A', set: 'X', number: '1', uid: 'A::X::1', found: 3, total: 10, pct: 30 })]
  };
  const result = canonicalizeReport(report, null);
  assert.deepStrictEqual(result, report);
});
