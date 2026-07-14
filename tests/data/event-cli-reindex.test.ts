/**
 * tests/data/event-cli-reindex.test.ts
 * event-cli reindex: rebuild cardUsage + conversion from decks via shared builders.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { reindexFromDecks } from '../../.github/scripts/event-cli.ts';

const decks = [
  { archetype: 'Gardevoir ex', madePhase2: true, cards: [{ name: 'Gardevoir ex', set: 'SVI', number: '86', count: 2 }, { name: 'Rare Candy', set: 'SVI', number: '191', count: 4 }] },
  { archetype: 'Gardevoir ex', madePhase2: false, cards: [{ name: 'Gardevoir ex', set: 'SVI', number: '86', count: 3 }] },
  { archetype: 'Charizard ex', madePhase2: true, cards: [{ name: 'Charizard ex', set: 'OBF', number: '125', count: 3 }] }
];

test('reindex rebuilds a cardUsage index keyed by canonical uid', () => {
  const { cardUsage } = reindexFromDecks(decks, null) as { cardUsage: { usage: Record<string, { slug: string; found: number }[]> } };
  // Gardevoir appears in both Gardevoir decks under its archetype slug.
  const gard = cardUsage.usage['Gardevoir ex::SVI::086'];
  assert.ok(gard, 'Gardevoir usage present');
  assert.strictEqual(gard.find(r => r.slug === 'Gardevoir_ex')?.found, 2);
});

test('reindex rebuilds conversion when a Day-2 deck exists, else null', () => {
  const { conversion } = reindexFromDecks(decks, null) as { conversion: { day1Total: number; day2Total: number } | null };
  assert.ok(conversion);
  assert.strictEqual(conversion.day1Total, 3);
  assert.strictEqual(conversion.day2Total, 2);
  // No Day-2 decks -> null.
  const noDay2 = reindexFromDecks(decks.map(d => ({ ...d, madePhase2: false })), null) as { conversion: unknown };
  assert.strictEqual(noDay2.conversion, null);
});
