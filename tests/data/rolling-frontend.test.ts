/**
 * Frontend tolerance for "rolling canonical" event artifacts.
 *
 * Rebaked historical events key their card-facing payloads by the event-date
 * canonical print — a variant UID from the same synonym cluster that still
 * resolves to the global canonical through the flat synonyms map. These tests
 * pin the read-time behavior the SPA must honor:
 *  - marked reports pass through the canonicalizer untouched (no re-mapping),
 *  - every cross-artifact join resolves BOTH sides to the global cluster
 *    identity, so a rolling key matches a global card and vice versa.
 *
 * Companion to the producer-side spec in rolling-rebake.test.ts.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canonicalizeReport,
  type CardUsageEntry,
  cardUsageForCard,
  type CardUsagePayload,
  findByClusterUid,
  findCardBySetNumberCanonical
} from '../../src/lib/data.ts';
import { computeMajorsMovers, type EventSnapshot } from '../../src/lib/majorsTrends.ts';
import { getCanonicalCardFromData, type SynonymDatabase } from '../../shared/synonyms.ts';
import type { CardItem } from '../../src/types';

const MEG_UID = "Boss's Orders::MEG::114";

// The cluster as the synonym producer emits it today: every variant (including
// the rolling canonicals BRS 132 / PAL 172) maps to the current global MEG 114.
const DB: SynonymDatabase = {
  synonyms: {
    "Boss's Orders::BRS::132": MEG_UID,
    "Boss's Orders::PAL::172": MEG_UID,
    "Boss's Orders::PAL::248": MEG_UID
  },
  canonicals: { "Boss's Orders": MEG_UID }
};

function item(partial: Partial<CardItem> & { name: string }): CardItem {
  return { found: 0, total: 0, pct: 0, ...partial };
}

// ---------------------------------------------------------------------------
// (a) canonicalizeReport: marked reports pass through, unmarked still merge.
// ---------------------------------------------------------------------------

test('canonicalizeReport: a canonicalizedAt-marked report passes through untouched', () => {
  const report = {
    deckTotal: 100,
    canonicalizedAt: '2024-09-13',
    items: [
      // Rolling canonical print — resolves to MEG 114 through the synonym map,
      // but must stay BRS 132 for period-correct display.
      item({ name: "Boss's Orders", set: 'BRS', number: '132', uid: "Boss's Orders::BRS::132", found: 20, pct: 20 })
    ]
  };
  const result = canonicalizeReport(report, DB);
  assert.equal(result, report, 'marked report returned by reference (no merge/clone)');
  assert.equal(result.items[0].uid, "Boss's Orders::BRS::132", 'rolling uid preserved');
  assert.equal(result.items[0].set, 'BRS');
  assert.equal(result.items[0].number, '132');
});

test('canonicalizeReport: an unmarked report still merges variant printings', () => {
  const report = {
    deckTotal: 100,
    items: [
      item({ name: "Boss's Orders", set: 'MEG', number: '114', uid: MEG_UID, found: 30, pct: 30 }),
      item({ name: "Boss's Orders", set: 'BRS', number: '132', uid: "Boss's Orders::BRS::132", found: 12, pct: 12 })
    ]
  };
  const result = canonicalizeReport(report, DB);
  assert.equal(result.items.length, 1, 'variants collapse to the global canonical row');
  assert.equal(result.items[0].uid, MEG_UID);
  assert.equal(result.items[0].found, 42);
});

// ---------------------------------------------------------------------------
// (b) cardUsageForCard: rolling-keyed usage found from either side.
// ---------------------------------------------------------------------------

function usageEntry(slug: string): CardUsageEntry {
  return { slug, found: 5, pct: 50, dist: [] };
}

test('cardUsageForCard: a rolling-keyed usage entry is found from a global-canonical card', () => {
  const payload: CardUsagePayload = {
    canonicalizedAt: '2024-09-13',
    usage: { "Boss's Orders::BRS::132": [usageEntry('gardevoir_ex')] }
  };
  const globalCard = item({ name: "Boss's Orders", set: 'MEG', number: '114', uid: MEG_UID });
  const rows = cardUsageForCard(payload, globalCard, DB);
  assert.ok(rows, 'global card resolves to the rolling-keyed cluster entry');
  assert.equal(rows![0].slug, 'gardevoir_ex');
});

test('cardUsageForCard: a rolling-keyed usage entry is found from a rolling-uid card (direct)', () => {
  const payload: CardUsagePayload = {
    canonicalizedAt: '2024-09-13',
    usage: { "Boss's Orders::BRS::132": [usageEntry('charizard_ex')] }
  };
  const rollingCard = item({ name: "Boss's Orders", set: 'BRS', number: '132', uid: "Boss's Orders::BRS::132" });
  const rows = cardUsageForCard(payload, rollingCard, DB);
  assert.ok(rows);
  assert.equal(rows![0].slug, 'charizard_ex');
});

test('cardUsageForCard: a global-keyed usage entry is found from a rolling-uid card', () => {
  // The reverse direction: an un-rebaked (global-keyed) event, queried with a
  // card carrying a rolling uid (e.g. navigated from a rebaked event's link).
  const payload: CardUsagePayload = { usage: { [MEG_UID]: [usageEntry('miraidon_ex')] } };
  const rollingCard = item({ name: "Boss's Orders", set: 'PAL', number: '172', uid: "Boss's Orders::PAL::172" });
  const rows = cardUsageForCard(payload, rollingCard, DB);
  assert.ok(rows);
  assert.equal(rows![0].slug, 'miraidon_ex');
});

test('cardUsageForCard: no DB still finds a direct uid hit but not a cluster hit', () => {
  const payload: CardUsagePayload = { usage: { "Boss's Orders::BRS::132": [usageEntry('gardevoir_ex')] } };
  const globalCard = item({ name: "Boss's Orders", set: 'MEG', number: '114', uid: MEG_UID });
  assert.equal(cardUsageForCard(payload, globalCard, null), null, 'no cluster match without a DB');
});

// ---------------------------------------------------------------------------
// (c) conversion stat matching across rolling keys (findByClusterUid).
// ---------------------------------------------------------------------------

test('findByClusterUid: a rolling-keyed conversion stat matches a global-canonical card', () => {
  const stats = [
    { uid: "Boss's Orders::BRS::132", conversion: 61 },
    { uid: 'Iono::PAL::185', conversion: 40 }
  ];
  const hit = findByClusterUid(stats, MEG_UID, DB);
  assert.ok(hit);
  assert.equal(hit!.conversion, 61);
});

test('findByClusterUid: a global-keyed stat matches a rolling card uid', () => {
  const stats = [{ uid: MEG_UID, conversion: 55 }];
  const hit = findByClusterUid(stats, "Boss's Orders::PAL::248", DB);
  assert.ok(hit);
  assert.equal(hit!.conversion, 55);
});

test('findByClusterUid: unrelated cards do not match', () => {
  const stats = [{ uid: 'Iono::PAL::185', conversion: 40 }];
  assert.equal(findByClusterUid(stats, MEG_UID, DB), undefined);
});

// ---------------------------------------------------------------------------
// (d) majors-trends: join one card across a rolling-keyed and a global-keyed
//     event snapshot.
// ---------------------------------------------------------------------------

function snapshot(dateIso: string, boss: { set: string; number: string; uid: string; pct: number }): EventSnapshot {
  return {
    tournament: dateIso,
    date: new Date(dateIso),
    archetypes: null,
    master: {
      deckTotal: 100,
      items: [
        item({ name: "Boss's Orders", set: boss.set, number: boss.number, uid: boss.uid, pct: boss.pct }),
        item({ name: 'Iono', set: 'PAL', number: '185', uid: 'Iono::PAL::185', pct: 25 })
      ]
    }
  };
}

const BRS = { set: 'BRS', number: '132', uid: "Boss's Orders::BRS::132" };
const MEG = { set: 'MEG', number: '114', uid: MEG_UID };

// Newest-first: two recent events (higher Boss share), two older (lower share),
// each half mixing a rolling-keyed and a global-keyed master for the same card.
const SNAPSHOTS: EventSnapshot[] = [
  snapshot('2026-06-01', { ...MEG, pct: 32 }),
  snapshot('2026-05-01', { ...BRS, pct: 30 }),
  snapshot('2026-04-01', { ...BRS, pct: 12 }),
  snapshot('2026-03-01', { ...MEG, pct: 10 })
];

test('computeMajorsMovers: without a resolver, rolling and global keys split the card into two rows', () => {
  const movers = computeMajorsMovers(SNAPSHOTS, 10);
  const bossRows = [...movers.rising, ...movers.falling].filter(m => m.name === "Boss's Orders");
  const keys = new Set(bossRows.map(m => `${m.set}::${m.number}`));
  assert.ok(keys.size >= 2, 'default set::number keying splits the card across events');
});

test('computeMajorsMovers: a global-canonical resolver joins the card into one rising mover', () => {
  const resolve = (i: CardItem) => getCanonicalCardFromData(DB, i.uid ?? `${i.name}::${i.set}::${i.number}`);
  const movers = computeMajorsMovers(SNAPSHOTS, 10, resolve);
  const bossRising = movers.rising.filter(m => m.name === "Boss's Orders");
  assert.equal(bossRising.length, 1, 'the card joins to a single mover row across all four events');
  // Display comes from the newest event's entry (global MEG print).
  assert.equal(bossRising[0].set, 'MEG');
  assert.equal(bossRising[0].number, '114');
  // Recent half ~31% vs older half ~11% → a clear positive delta.
  assert.ok(bossRising[0].delta > 15, 'pooled recent-minus-older delta reflects all events');
});

// ---------------------------------------------------------------------------
// findCardBySetNumberCanonical: URL (global) ↔ master item (rolling).
// ---------------------------------------------------------------------------

test('findCardBySetNumberCanonical: the global-canonical URL finds a rolling master item', () => {
  const items = [item({ name: "Boss's Orders", set: 'BRS', number: '132', uid: "Boss's Orders::BRS::132" })];
  const found = findCardBySetNumberCanonical(items, 'MEG', '114', DB);
  assert.ok(found, 'global set/number resolves to the rolling-print item');
  assert.equal(found!.set, 'BRS');
});

test('findCardBySetNumberCanonical: a stale variant URL finds the same rolling item', () => {
  const items = [item({ name: "Boss's Orders", set: 'BRS', number: '132', uid: "Boss's Orders::BRS::132" })];
  const found = findCardBySetNumberCanonical(items, 'PAL', '248', DB);
  assert.ok(found);
  assert.equal(found!.set, 'BRS');
});
