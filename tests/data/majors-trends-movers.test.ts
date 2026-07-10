import test from 'node:test';
import assert from 'node:assert/strict';

import { computeMajorsMovers, type EventSnapshot } from '../../src/lib/majorsTrends.ts';
import type { CardItem } from '../../src/types';

function card(pct: number): CardItem {
  return { name: 'Iono', set: 'PAF', number: '080', pct } as CardItem;
}

function event(tournament: string, date: string, items: CardItem[], deckTotal = 100): EventSnapshot {
  return {
    tournament,
    date: new Date(date),
    master: { deckTotal, items },
    archetypes: null
  };
}

test('majors movers count absent events as 0% share in the half average', () => {
  // Regression for P-28. Recent half: the card holds 20% in one of two equal
  // events and is absent from the other. The true pooled share is 10%, not the
  // 20% the old denominator (present events only) reported.
  const snapshots: EventSnapshot[] = [
    // most-recent first
    event('r0', '2026-07-08', [card(20)]),
    event('r1', '2026-07-07', []),
    event('o0', '2026-07-02', [card(10)]),
    event('o1', '2026-07-01', [card(10)])
  ];

  const result = computeMajorsMovers(snapshots);
  assert.equal(result.enoughForMovers, true);
  const row = [...result.rising, ...result.falling].find(m => m.set === 'PAF' && m.number === '080');
  assert.ok(row, 'the card should appear as a mover');
  assert.ok(Math.abs((row!.recentAvg ?? 0) - 10) < 1e-9, `recentAvg should be the pooled 10%, got ${row!.recentAvg}`);
});

test('a card absent from the entire older half is still treated as a newcomer', () => {
  // The absent-events-as-0% fix must not break newcomer detection: olderAvg is
  // null only when the card never appears in the older half at all.
  const snapshots: EventSnapshot[] = [
    event('r0', '2026-07-08', [card(30)]),
    event('r1', '2026-07-07', [card(30)]),
    event('o0', '2026-07-02', []),
    event('o1', '2026-07-01', [])
  ];

  const result = computeMajorsMovers(snapshots);
  const newcomer = result.newcomers.find(m => m.set === 'PAF' && m.number === '080');
  assert.ok(newcomer, 'card present only in the recent half is a newcomer');
  assert.equal(newcomer!.olderAvg, null);
});
