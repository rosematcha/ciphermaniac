import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { deckSection, type OrderableCard, resolveCategory, sortByDeckOrder } from '../../src/lib/cardOrder.ts';
import type { CardFacetMap } from '../../src/lib/data/cardFacets.ts';

/** Build a facet map from a terse `"SET::NUM": [category, stage, evolvesFrom]` table. */
function facetMap(entries: Record<string, [string | null, string | null, string | null]>): CardFacetMap {
  return new Map(
    Object.entries(entries).map(([key, [category, stage, evolvesFrom]]) => [key, { category, stage, evolvesFrom }])
  );
}

const card = (name: string, set: string, number: string, pct: number, category?: string): OrderableCard => ({
  name,
  set,
  number,
  pct,
  ...(category === undefined ? {} : { category })
});

describe('deckSection', () => {
  it('splits trainers by subtype and keeps ace specs with their base subtype', () => {
    assert.equal(deckSection(card("Boss's Orders", 'MEG', '114', 99, 'trainer/supporter'), null), 'supporter');
    assert.equal(deckSection(card('Ultra Ball', 'MEG', '131', 99, 'trainer/item'), null), 'item');
    assert.equal(deckSection(card('Unfair Stamp', 'TWM', '165', 92, 'trainer/item/acespec'), null), 'item');
    assert.equal(deckSection(card('Hero Cape', 'TWM', '152', 20, 'trainer/tool'), null), 'tool');
    assert.equal(deckSection(card('Area Zero', 'SVI', '131', 40, 'trainer/stadium'), null), 'stadium');
  });

  it('sends a subtype-less trainer to its own bucket rather than guessing', () => {
    assert.equal(deckSection(card('Poké Pad', 'ASC', '198', 99, 'trainer'), null), 'trainerOther');
  });

  it('separates special from basic energy', () => {
    assert.equal(deckSection(card('Neo Upper Energy', 'TEF', '162', 30, 'energy/special'), null), 'energySpecial');
    assert.equal(deckSection(card('Fire Energy', 'MEE', '002', 99, 'energy'), null), 'energyBasic');
  });

  it('prefers the facet category over a stale report category', () => {
    const facets = facetMap({ 'ASC::198': ['trainer/item', null, null] });
    const stale = card('Poké Pad', 'ASC', '198', 99, 'trainer');
    assert.equal(resolveCategory(stale, facets), 'trainer/item');
    assert.equal(deckSection(stale, facets), 'item');
  });

  it('falls back to the supertype when nothing carries a category', () => {
    assert.equal(deckSection({ name: 'Mystery Card', supertype: 'Trainer' }, null), 'trainerOther');
    assert.equal(deckSection({ name: 'Mystery Card', supertype: 'Energy' }, null), 'energyBasic');
    assert.equal(deckSection({ name: 'Mystery Card' }, null), 'pokemon');
  });
});

describe('sortByDeckOrder', () => {
  const facets = facetMap({
    'JTG::024': ['pokemon', 'stage2', 'combusken'],
    'DRI::041': ['pokemon', 'stage1', 'torchic'],
    'DRI::040': ['pokemon', 'basic', null],
    'JTG::022': ['pokemon', 'basic', null],
    'PRE::073': ['pokemon', 'stage2', 'drakloak'],
    'TWM::129': ['pokemon', 'stage1', 'dreepy'],
    'TWM::128': ['pokemon', 'basic', null],
    'SFA::038': ['pokemon', 'basic', null],
    'MEG::114': ['trainer/supporter', null, null],
    'MEG::131': ['trainer/item', null, null],
    'TWM::152': ['trainer/tool', null, null],
    'MEE::002': ['energy', null, null]
  });

  const names = (cards: OrderableCard[]): string[] => cards.map(c => c.name);

  it('orders sections Pokémon → supporter → item → tool → energy', () => {
    const input = [
      card('Fire Energy', 'MEE', '002', 99),
      card('Hero Cape', 'TWM', '152', 20),
      card('Ultra Ball', 'MEG', '131', 99),
      card("Boss's Orders", 'MEG', '114', 99),
      card('Fezandipiti ex', 'SFA', '038', 99)
    ];
    assert.deepEqual(names(sortByDeckOrder(input, facets)), [
      'Fezandipiti ex',
      "Boss's Orders",
      'Ultra Ball',
      'Hero Cape',
      'Fire Energy'
    ]);
  });

  it('groups an evolution line bottom-up and ranks lines by their best member', () => {
    const input = [
      card('Blaziken ex', 'JTG', '024', 99.87),
      card('Dragapult ex', 'PRE', '073', 99.87),
      card('Drakloak', 'TWM', '129', 99.87),
      card('Dreepy', 'TWM', '128', 99.87),
      card('Torchic', 'DRI', '040', 99.23),
      card('Combusken', 'DRI', '041', 97.17),
      card('Fezandipiti ex', 'SFA', '038', 99.23)
    ];
    const sorted = names(sortByDeckOrder(input, facets));
    // Each line reads basic → stage 1 → stage 2, uninterrupted.
    assert.deepEqual(sorted.slice(0, 3), ['Dreepy', 'Drakloak', 'Dragapult ex']);
    assert.deepEqual(sorted.slice(3, 6), ['Torchic', 'Combusken', 'Blaziken ex']);
    assert.deepEqual(sorted.slice(6), ['Fezandipiti ex']);
  });

  it('keeps printings of the same Pokémon adjacent, most-played first', () => {
    const input = [
      card('Torchic', 'JTG', '022', 0.77),
      card('Combusken', 'DRI', '041', 97.17),
      card('Torchic', 'DRI', '040', 99.23),
      card('Blaziken ex', 'JTG', '024', 99.87)
    ];
    assert.deepEqual(names(sortByDeckOrder(input, facets)), ['Torchic', 'Torchic', 'Combusken', 'Blaziken ex']);
    assert.equal(sortByDeckOrder(input, facets)[0].set, 'DRI');
  });

  it('treats an evolution whose pre-evolution is absent as its own line', () => {
    const input = [card('Blaziken ex', 'JTG', '024', 60), card('Fezandipiti ex', 'SFA', '038', 99)];
    // Blaziken ex has no Combusken to sit under, so it ranks on its own usage.
    assert.deepEqual(names(sortByDeckOrder(input, facets)), ['Fezandipiti ex', 'Blaziken ex']);
  });

  it('anchors a line on its root stage when the chain starts mid-evolution', () => {
    // Shieldon is a Stage 1 that evolves from a fossil ITEM, so its
    // pre-evolution can never appear in the Pokémon section. Without a stage
    // anchor it and its Bastiodon both sit at depth 0 and the more-played
    // Bastiodon sorts above the Shieldon it evolves from.
    const fossil = facetMap({
      'PBL::061': ['pokemon', 'stage1', 'antique armor fossil'],
      'MEP::085': ['pokemon', 'stage2', 'shieldon']
    });
    const input = [card('Bastiodon', 'MEP', '085', 0.26), card('Shieldon', 'PBL', '061', 0.13)];
    assert.deepEqual(names(sortByDeckOrder(input, fossil)), ['Shieldon', 'Bastiodon']);
  });

  it('falls back to usage order within sections when facets are unavailable', () => {
    const input = [
      card('Combusken', 'DRI', '041', 97.17, 'pokemon'),
      card('Torchic', 'DRI', '040', 99.23, 'pokemon'),
      card('Ultra Ball', 'MEG', '131', 99.61, 'trainer/item')
    ];
    assert.deepEqual(names(sortByDeckOrder(input, null)), ['Torchic', 'Combusken', 'Ultra Ball']);
  });

  it('does not mutate the input array', () => {
    const input = [card('Ultra Ball', 'MEG', '131', 99), card('Fezandipiti ex', 'SFA', '038', 50)];
    const before = names(input);
    sortByDeckOrder(input, facets);
    assert.deepEqual(names(input), before);
  });

  it('survives a cyclic evolution chain', () => {
    const cyclic = facetMap({
      'AAA::001': ['pokemon', 'stage1', 'b'],
      'AAA::002': ['pokemon', 'stage1', 'a']
    });
    const input = [card('A', 'AAA', '001', 50), card('B', 'AAA', '002', 60)];
    assert.equal(sortByDeckOrder(input, cyclic).length, 2);
  });
});
