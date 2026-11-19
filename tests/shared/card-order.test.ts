import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  type CardFacetMap,
  cardFacetsFromTypes,
  deckOrderedItems,
  deckSection,
  type OrderableCard,
  producerFacets,
  resolveCategory,
  sortByDeckOrder
} from '../../shared/data/cardOrder.ts';

/** Build a facet map from a terse `"SET::NUM": [category, stage, evolvesFrom]` table. */
function facetMap(entries: Record<string, [string | null, string | null, string | null]>): CardFacetMap {
  return new Map(
    Object.entries(entries).map(([key, [category, stage, evolvesFrom]]) => [key, { category, stage, evolvesFrom }])
  );
}

const names = (cards: OrderableCard[]): string[] => cards.map(c => c.name);
const ignore = (): void => {};

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

describe('deckOrderedItems', () => {
  const facets = facetMap({
    'SFA::057': ['trainer/supporter', null, null],
    'TWM::165': ['trainer/item', null, null],
    'ASC::001': ['pokemon', 'basic', null],
    'ASC::002': ['pokemon', 'stage1', "erika's oddish"],
    'TWM::128': ['pokemon', 'basic', null]
  });

  it('writes the category each card was sorted under, keeping an ACE SPEC suffix', () => {
    const { items } = deckOrderedItems(
      [
        card("Colress's Tenacity", 'SFA', '057', 90, 'trainer/item'),
        card('Unfair Stamp', 'TWM', '165', 80, 'trainer/item/acespec')
      ],
      facets,
      ignore
    );
    assert.deepEqual(
      items.map(c => [c.name, c.category]),
      [
        ["Colress's Tenacity", 'trainer/supporter'],
        ['Unfair Stamp', 'trainer/item/acespec']
      ]
    );
  });

  it('marks only a complete order: without card types it groups by category and stays unmarked', () => {
    const items = [card('Ultra Ball', 'MEG', '131', 99, 'trainer/item'), card('Dreepy', 'TWM', '128', 50, 'pokemon')];
    const fallback = deckOrderedItems(items, null, ignore);
    assert.deepEqual(names(fallback.items), ['Dreepy', 'Ultra Ball']);
    assert.equal(fallback.itemOrder, undefined);
    assert.equal(deckOrderedItems(items, facets, ignore).itemOrder, 'deck');

    const warnings: string[] = [];
    assert.equal(
      producerFacets({}, message => warnings.push(message)),
      null
    );
    assert.equal(warnings.length, 1);
  });

  it('finds facets for a lower-case set and an unpadded number', () => {
    const items = [card("Erika's Gloom", 'asc', '2', 90, 'pokemon'), card("Erika's Oddish", 'asc', '1', 40, 'pokemon')];
    assert.deepEqual(names(deckOrderedItems(items, facets, ignore).items), ["Erika's Oddish", "Erika's Gloom"]);
  });

  it('counts a null or empty card-types entry as missing', () => {
    const items = [
      card('Dragapult ex', 'TWM', '130', 95, 'pokemon'),
      card('Drakloak', 'TWM', '129', 91, 'pokemon'),
      card('Dreepy', 'TWM', '128', 8, 'pokemon')
    ];
    const database = (drakloak: unknown) =>
      cardFacetsFromTypes({
        'TWM::128': { cardType: 'pokemon', stage: 'basic', evolutionInfo: 'Basic' },
        'TWM::129': drakloak as never,
        'TWM::130': { cardType: 'pokemon', stage: 'stage2', evolutionInfo: 'Stage 2 - Evolves from Drakloak' }
      });
    for (const drakloak of [null, {}, { metadataVersion: 2 }]) {
      const warnings: string[] = [];
      const result = deckOrderedItems(items, database(drakloak), message => warnings.push(message));
      assert.equal(result.itemOrder, undefined, JSON.stringify(drakloak));
      assert.match(warnings[0] ?? '', /TWM::129/);
    }
    const complete = database({ cardType: 'pokemon', stage: 'stage1', evolutionInfo: 'Stage 1 - Evolves from Dreepy' });
    const ordered = deckOrderedItems(items, complete, ignore);
    assert.equal(ordered.itemOrder, 'deck');
    assert.deepEqual(names(ordered.items), ['Dreepy', 'Drakloak', 'Dragapult ex']);
  });

  it('marks a report only when every Pokémon has usable evolution data, trimming blank fields', () => {
    const items = [
      card('Dragapult ex', 'TWM', '130', 100, 'pokemon'),
      card('Drakloak', 'TWM', '129', 50, 'pokemon'),
      card('Dreepy', 'TWM', '128', 25, 'pokemon'),
      card("Boss's Orders", 'PAL', '172', 90, 'trainer/supporter')
    ];
    const complete = {
      'TWM::128': { cardType: 'pokemon', stage: 'basic', evolutionInfo: 'Basic' },
      'TWM::129': { cardType: 'pokemon', stage: 'stage1', evolutionInfo: 'Stage 1 - Evolves from Dreepy' },
      'TWM::130': { cardType: 'pokemon', stage: 'stage2', evolutionInfo: 'Stage 2 - Evolves from Drakloak' },
      'PAL::172': { cardType: 'trainer', subType: 'supporter' }
    };
    const cases = [
      ['numeric stage, no parent', { 'TWM::129': { cardType: 'pokemon', stage: 1 } }, false],
      ['stage1 without a parent', { 'TWM::129': { cardType: 'pokemon', stage: 'stage1' } }, false],
      ['blank stage only', { 'TWM::129': { stage: '  ' } }, false],
      ['blank card type on a trainer', { 'PAL::172': { cardType: '  ' } }, true],
      [
        'numeric stage with a valid parent',
        { 'TWM::129': { cardType: 'pokemon', stage: 1, evolutionInfo: 'Stage 1 - Evolves from Dreepy' } },
        true
      ]
    ] as const;
    for (const [name, change, marked] of cases) {
      const warnings: string[] = [];
      const result = deckOrderedItems(items, cardFacetsFromTypes({ ...complete, ...change } as never), message =>
        warnings.push(message)
      );
      assert.equal(result.itemOrder, marked ? 'deck' : undefined, name);
      assert.equal(warnings.length > 0, !marked, name);
      if (marked) {
        assert.deepEqual(names(result.items), ['Dreepy', 'Drakloak', 'Dragapult ex', "Boss's Orders"], name);
      } else {
        assert.match(warnings[0], /TWM::129/, name);
      }
      const boss = result.items.find(item => item.name === "Boss's Orders");
      const drakloak = result.items.find(item => item.name === 'Drakloak');
      assert.equal(boss?.category, 'trainer/supporter', name);
      assert.equal(drakloak?.category, 'pokemon', name);
    }
  });

  it("places a line whose parent the database spells with a spaced hyphen ('Jangmo - o')", () => {
    // Production card-types entries for the Kommo-o line, all played at 100%.
    const database = cardFacetsFromTypes({
      '30C::110': { cardType: 'pokemon', stage: 'basic', evolutionInfo: 'Basic' },
      '30C::111': { cardType: 'pokemon', stage: 'stage1', evolutionInfo: 'Stage 1 - Evolves from Jangmo - o' },
      '30C::112': { cardType: 'pokemon', stage: 'stage2', evolutionInfo: 'Stage 2 - Evolves from Hakamo - o' }
    });
    const items = [
      card('Kommo-o', '30C', '112', 100, 'pokemon'),
      card('Hakamo-o', '30C', '111', 100, 'pokemon'),
      card('Jangmo-o', '30C', '110', 100, 'pokemon')
    ];
    const result = deckOrderedItems(items, database, ignore);
    assert.deepEqual(names(result.items), ['Jangmo-o', 'Hakamo-o', 'Kommo-o']);
    assert.equal(result.itemOrder, 'deck');
  });

  it('treats a fossil Stage 1 with an empty "Evolves from" as the start of its line', () => {
    // Production card-types entries: Lileep evolves from an Item, so its parent is recorded empty.
    const database = cardFacetsFromTypes({
      'SCR::005': { cardType: 'pokemon', stage: 'stage1', evolutionInfo: 'Stage 1 - Evolves from' },
      'SCR::006': { cardType: 'pokemon', stage: 'stage2', evolutionInfo: 'Stage 2 - Evolves from Lileep' }
    });
    const items = [card('Cradily', 'SCR', '006', 90, 'pokemon'), card('Lileep', 'SCR', '005', 60, 'pokemon')];
    const result = deckOrderedItems(items, database, ignore);
    assert.equal(result.itemOrder, 'deck');
    assert.deepEqual(names(result.items), ['Lileep', 'Cradily']);
  });

  it('matches a parent the database writes without accents (Flabebe) to its card (Flabébé)', () => {
    // Production card-types entries for the Floette line.
    const database = cardFacetsFromTypes({
      'TWM::086': { cardType: 'pokemon', stage: 'basic', evolutionInfo: 'Basic' },
      'TWM::087': { cardType: 'pokemon', stage: 'stage1', evolutionInfo: 'Stage 1 - Evolves from Flabebe' },
      'TWM::088': { cardType: 'pokemon', stage: 'stage2', evolutionInfo: 'Stage 2 - Evolves from Floette' }
    });
    const items = [
      card('Florges', 'TWM', '088', 90, 'pokemon'),
      card('Floette', 'TWM', '087', 30, 'pokemon'),
      card('Flabébé', 'TWM', '086', 20, 'pokemon')
    ];
    assert.deepEqual(names(deckOrderedItems(items, database, ignore).items), ['Flabébé', 'Floette', 'Florges']);
  });

  it('leaves the marker off and names the cards when a Pokémon lacks a facet', () => {
    // Drakloak's print is newer than the database, so its line can't be placed.
    const partial = facetMap({
      'TWM::128': ['pokemon', 'basic', null],
      'TWM::130': ['pokemon', 'stage2', 'drakloak']
    });
    const items = [
      card('Dragapult ex', 'TWM', '130', 95, 'pokemon'),
      card('Drakloak', 'TWM', '129', 91, 'pokemon'),
      card('Dreepy', 'TWM', '128', 8, 'pokemon')
    ];
    const warnings: string[] = [];
    const result = deckOrderedItems(items, partial, message => warnings.push(message));
    assert.equal(result.itemOrder, undefined);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /TWM::129/);
  });

  it('names a pre-evolution only when the list plays it, as the list writes it', () => {
    const lines = facetMap({
      'DRI::041': ['pokemon', 'stage1', 'torchic'],
      'DRI::040': ['pokemon', 'basic', null],
      'JTG::024': ['pokemon', 'stage2', 'combusken']
    });
    const { items } = deckOrderedItems(
      [card('Combusken', 'DRI', '041', 97), card('Torchic', 'DRI', '040', 99), card('Blaziken ex', 'JTG', '024', 60)],
      lines,
      ignore
    );
    assert.deepEqual(
      items.map(item => [item.name, item.evolvesFrom]),
      [
        ['Torchic', undefined],
        ['Combusken', 'Torchic'],
        ['Blaziken ex', 'Combusken']
      ]
    );
    const alone = deckOrderedItems([card('Blaziken ex', 'JTG', '024', 60)], lines, ignore).items[0];
    assert.equal('evolvesFrom' in alone, false);
    // Card types spell it "Flabebe"; the list's own spelling is what the page matches.
    const floette = deckOrderedItems(
      [card('Floette', 'TWM', '087', 30, 'pokemon'), card('Flabébé', 'TWM', '086', 20, 'pokemon')],
      cardFacetsFromTypes({
        'TWM::086': { cardType: 'pokemon', stage: 'basic', evolutionInfo: 'Basic' },
        'TWM::087': { cardType: 'pokemon', stage: 'stage1', evolutionInfo: 'Stage 1 - Evolves from Flabebe' }
      }),
      ignore
    );
    assert.deepEqual(
      floette.items.map(item => item.evolvesFrom),
      [undefined, 'Flabébé']
    );
  });
});

it('a bare trainer facet does not hide a more specific report category', () => {
  const bare = facetMap({ 'SVI::001': ['trainer', null, null] });
  assert.equal(
    resolveCategory(card('Some Supporter', 'SVI', '001', 50, 'trainer/supporter'), bare),
    'trainer/supporter'
  );
});
