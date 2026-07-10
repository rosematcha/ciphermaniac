import { describe, it } from 'node:test';
import assert from 'node:assert';
import { aggregateCanonicalCardsPerDeck } from '../../shared/canonicalDeckCards.ts';
import type { SynonymDatabase } from '../../shared/synonyms.ts';

const db: SynonymDatabase = {
  synonyms: { 'Pikachu::OLD::002': 'Pikachu::NEW::001' },
  canonicals: {},
  metadata: {}
} as SynonymDatabase;

describe('aggregateCanonicalCardsPerDeck', () => {
  it('collapses two printings mapped to the same canonical into one entry', () => {
    const deck = aggregateCanonicalCardsPerDeck(
      [
        { name: 'Pikachu', set: 'OLD', number: '002', count: 2 },
        { name: 'Pikachu', set: 'NEW', number: '001', count: 1 }
      ],
      db
    );
    assert.strictEqual(deck.size, 1, 'both printings collapse to one canonical UID');
    const card = deck.get('Pikachu::NEW::001');
    assert.ok(card, 'keyed by the canonical UID');
    assert.strictEqual(card.copies, 3, 'copies summed across printings');
  });

  it('derives name/set/number from the canonical UID, not the first-seen variant', () => {
    const deck = aggregateCanonicalCardsPerDeck([{ name: 'Pikachu', set: 'OLD', number: '002', count: 1 }], db);
    const card = deck.get('Pikachu::NEW::001');
    assert.ok(card);
    assert.strictEqual(card.set, 'NEW');
    assert.strictEqual(card.number, '001');
  });

  it('normalizes number padding before the synonym lookup', () => {
    const deck = aggregateCanonicalCardsPerDeck([{ name: 'Pikachu', set: 'OLD', number: '2', count: 1 }], db);
    assert.ok(deck.get('Pikachu::NEW::001'), 'unpadded variant number still hits the mapping');
  });

  it('keeps distinct cards separate and skips zero-count rows', () => {
    const deck = aggregateCanonicalCardsPerDeck(
      [
        { name: 'Pikachu', set: 'NEW', number: '001', count: 4 },
        { name: 'Oddish', set: 'NEW', number: '003', count: 0 },
        { name: 'Gloom', set: 'NEW', number: '004', count: 2 }
      ],
      db
    );
    assert.strictEqual(deck.size, 2);
    assert.strictEqual(deck.get('Pikachu::NEW::001')?.copies, 4);
    assert.strictEqual(deck.get('Gloom::NEW::004')?.copies, 2);
  });

  it('works without a synonym database (null)', () => {
    const deck = aggregateCanonicalCardsPerDeck([{ name: 'Pikachu', set: 'NEW', number: '001', count: 1 }], null);
    assert.ok(deck.get('Pikachu::NEW::001'));
  });

  it('falls back to bare name when set/number are absent', () => {
    const deck = aggregateCanonicalCardsPerDeck([{ name: 'Basic Psychic Energy', count: 6 }], null);
    const card = deck.get('Basic Psychic Energy');
    assert.ok(card);
    assert.strictEqual(card.set, null);
    assert.strictEqual(card.copies, 6);
  });
});
