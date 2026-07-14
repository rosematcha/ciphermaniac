import test from 'node:test';
import assert from 'node:assert/strict';

import { mockFetch, restoreFetch } from '../__utils__/test-helpers';

import {
  cardUsageForCard,
  type CardUsagePayload,
  fetchCardUsage,
  fetchConversionIndex,
  fetchDay2CardStats
} from '../../src/lib/data.ts';
import type { CardItem } from '../../src/types';

const CARD: CardItem = {
  name: "Boss's Orders",
  set: 'MEG',
  number: '114',
  uid: "Boss's Orders::MEG::114",
  found: 100,
  total: 200,
  pct: 50
};

test('cardUsageForCard resolves by canonical UID', () => {
  const payload: CardUsagePayload = {
    usage: {
      "Boss's Orders::MEG::114": [{ slug: 'dragapult_dusknoir', found: 10, pct: 80, dist: [] }]
    }
  };
  const rows = cardUsageForCard(payload, CARD, null);
  assert.ok(rows);
  assert.strictEqual(rows!.length, 1);
  assert.strictEqual(rows![0].slug, 'dragapult_dusknoir');
});

test('cardUsageForCard falls back to set+number match with normalized leading zeros', () => {
  const payload: CardUsagePayload = {
    // Index keyed by a zero-padded number; card carries an unpadded number.
    usage: {
      "Boss's Orders::MEG::0114": [{ slug: 'gardevoir', found: 3, pct: 25, dist: [] }]
    }
  };
  const rows = cardUsageForCard(payload, { ...CARD, uid: undefined }, null);
  assert.ok(rows);
  assert.strictEqual(rows![0].slug, 'gardevoir');
});

test('cardUsageForCard returns null when the card is absent', () => {
  const payload: CardUsagePayload = { usage: {} };
  assert.strictEqual(cardUsageForCard(payload, CARD, null), null);
});

test('fetchCardUsage returns null on 404', async () => {
  mockFetch({ predicate: () => true, status: 404, body: null });
  try {
    const res = await fetchCardUsage(`2026-01-01, Regional Championship Nowhere ${Math.random()}`);
    assert.strictEqual(res, null);
  } finally {
    restoreFetch();
  }
});

test('fetchDay2CardStats uses precomputed conversion.json when present', async () => {
  const tour = `conv-${Math.random()}`;
  mockFetch({
    predicate: () => true,
    handler: (input: RequestInfo) => {
      const url = String(input);
      if (url.includes('/conversion.json')) {
        return {
          status: 200,
          body: { day1Total: 10, day2Total: 4, cards: { "Boss's Orders::MEG::114": { day1: 5, day2: 3 } } }
        };
      }
      if (url.includes('/master.json')) {
        return { status: 200, body: { deckTotal: 10, items: [CARD] } };
      }
      // synonyms + anything else
      return { status: 404, body: null };
    }
  });
  try {
    const stats = await fetchDay2CardStats(tour);
    assert.ok(stats);
    assert.strictEqual(stats!.length, 1);
    assert.strictEqual(stats![0].uid, "Boss's Orders::MEG::114");
    assert.strictEqual(stats![0].day1Count, 5);
    assert.strictEqual(stats![0].day2Count, 3);
    assert.ok(Math.abs(stats![0].conversion - 60) < 0.001);
  } finally {
    restoreFetch();
  }
});

test('fetchDay2CardStats falls back to decks.json when conversion.json is missing', async () => {
  const tour = `fallback-${Math.random()}`;
  const decks = [
    { madePhase2: true, cards: [{ name: "Boss's Orders", set: 'MEG', number: '114', count: 1 }] },
    { madePhase2: false, cards: [{ name: "Boss's Orders", set: 'MEG', number: '114', count: 2 }] }
  ];
  mockFetch({
    predicate: () => true,
    handler: (input: RequestInfo) => {
      const url = String(input);
      if (url.includes('/conversion.json')) {
        return { status: 404, body: null };
      }
      if (url.includes('/decks.json')) {
        return { status: 200, body: decks };
      }
      if (url.includes('/master.json')) {
        return { status: 200, body: { deckTotal: 2, items: [CARD] } };
      }
      return { status: 404, body: null };
    }
  });
  try {
    const stats = await fetchDay2CardStats(tour);
    assert.ok(stats);
    const boss = stats!.find(s => s.uid === "Boss's Orders::MEG::114");
    assert.ok(boss);
    assert.strictEqual(boss!.day1Count, 2);
    assert.strictEqual(boss!.day2Count, 1);
  } finally {
    restoreFetch();
  }
});

test('fetchConversionIndex returns null on 404', async () => {
  mockFetch({ predicate: () => true, status: 404, body: null });
  try {
    assert.strictEqual(await fetchConversionIndex(`missing-${Math.random()}`), null);
  } finally {
    restoreFetch();
  }
});
