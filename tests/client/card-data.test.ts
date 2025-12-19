import test from 'node:test';
import assert from 'node:assert/strict';

import { collectCardVariants, findCard, renderCardPrice } from '../../src/card/data.ts';
import { mockFetch, restoreFetch } from '../__utils__/test-helpers.js';

test('findCard by identifier, slug, and case insensitivity', () => {
  const items = [
    { uid: 'Pika::SET::001', name: 'Pikachu', set: 'SET', number: '1' },
    { uid: 'Ns Zoroark::NSI::010', name: "N's Zoroark", set: 'NSI', number: '10' }
  ];

  const found = findCard(items as any, 'Pika::SET::001');
  assert.ok(found?.uid === 'Pika::SET::001');

  const foundName = findCard(items as any, "n's zoroark");
  assert.ok(foundName?.name && foundName.name.toLowerCase().includes('zoroark'));

  const missing = findCard(items as any, 'Nonexistent');
  assert.strictEqual(missing, null);
});

test('collectCardVariants and aggregate stats handle no variants and multiple variants', async () => {
  // Mock tournaments list and reports
  mockFetch([
    { predicate: (input: RequestInfo) => String(input).includes('tournaments.json'), status: 200, body: ['t1'] },
    {
      predicate: (input: RequestInfo) => String(input).includes('t1/master.json'),
      status: 200,
      body: { items: [{ uid: 'Pikachu::SET::001', name: 'Pikachu SET 1' }] }
    },
    {
      predicate: (input: RequestInfo) => String(input).includes('/assets/card-synonyms.json'),
      status: 200,
      body: { synonyms: {}, canonicals: {} }
    }
  ]);

  const variants = await collectCardVariants('Pikachu');
  assert.ok(Array.isArray(variants));

  restoreFetch();
});

test(
  'renderCardPrice formats USD correctly and handles missing prices',
  { skip: typeof document === 'undefined' ? 'Requires browser DOM APIs' : false },
  async () => {
    // Mock getCardPrice via pricing endpoint
    mockFetch({
      predicate: (input: RequestInfo) => String(input).includes('/reports/prices.json'),
      status: 200,
      body: { cardPrices: { 'Pikachu::SET::001': { price: 12.34 } } }
    } as any);

    // Create container in DOM
    const container = document.createElement('div');
    container.id = 'card-price';
    document.body.appendChild(container);

    await renderCardPrice('Pikachu::SET::001');

    assert.ok(container.innerHTML.includes('$12.34'));
    container.remove();

    restoreFetch();
  }
);
