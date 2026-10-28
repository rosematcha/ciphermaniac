import test from 'node:test';
import assert from 'node:assert/strict';

import { compileDeckRules, type DeckRule, deckRuleIcons, matchDeckRules } from '../../shared/formats/deckRules';
import { loadCityLeagueRules, nameCityLeagueDecks } from '../../.github/scripts/lib/cityLeagues/archetypes';
import type { GatheredDeck } from '../../shared/onlineMeta/types';

// Rules as Limitless sends them (trimmed from /games/PTCG/decks, 2026-10-28).
const LIMITLESS: DeckRule[] = [
  {
    identifier: 'dragapult-ex',
    name: 'Dragapult',
    icons: ['dragapult'],
    priority: 11,
    cards: [{ name: 'Dragapult ex', count: '2' }],
    variants: [
      { identifier: 'dragapult-dusknoir', name: 'Dragapult Dusknoir', icon: 'dusknoir', cards: [{ name: 'Dusknoir' }] }
    ],
    generation: 9
  },
  {
    identifier: 'kangaskhan-bouffalant',
    name: 'Kangaskhan Bouffalant',
    icons: ['kangaskhan-mega', 'bouffalant'],
    priority: 10,
    cards: [
      { name: 'Mega Kangaskhan ex', count: '2' },
      { name: 'Bouffalant', count: '2' },
      { name: 'Jumbo Ice Cream' }
    ],
    variants: [],
    generation: 9
  },
  {
    identifier: 'mega-froslass-ex',
    name: 'Mega Froslass',
    icons: ['froslass-mega'],
    priority: 30,
    cards: [{ name: 'Mega Froslass ex', count: '2' }],
    variants: [],
    generation: 9
  },
  {
    identifier: 'mega-lopunny-ex',
    name: 'Mega Lopunny',
    icons: ['lopunny-mega'],
    priority: 30,
    cards: [
      { name: 'Mega Lopunny ex', count: '1' },
      { name: 'Buneary', count: '2' }
    ],
    variants: [],
    generation: 9
  },
  {
    identifier: 'dhelmise-pbl',
    name: 'Dhelmise',
    icons: ['dhelmise', 'banette'],
    priority: 10,
    cards: [
      { name: 'Dhelmise', count: '3', set: 'PBL' },
      { name: 'Banette', set: 'PBL' }
    ],
    variants: [],
    generation: 9
  },
  {
    identifier: 'dragapult-vmax',
    name: 'Dragapult (old)',
    icons: ['dragapult'],
    priority: 1,
    cards: [{ name: 'Dragapult ex' }],
    variants: [],
    generation: 8
  },
  { identifier: null, name: null, icons: [], priority: 10, cards: [], variants: [] }
];

const card = (count: number, name: string, set = 'SET', number = '1') => ({ count, name, set, number });

test('a deck takes the first matching rule by priority', () => {
  const rules = compileDeckRules(LIMITLESS);
  const deck = [
    card(3, 'Dragapult ex'),
    card(4, 'Mega Kangaskhan ex'),
    card(2, 'Bouffalant'),
    card(1, 'Jumbo Ice Cream')
  ];
  assert.equal(matchDeckRules(deck, rules)?.name, 'Kangaskhan Bouffalant');
});

test('a matching variant names the deck, with the parent icon then its own', () => {
  const rules = compileDeckRules(LIMITLESS);
  const match = matchDeckRules([card(3, 'Dragapult ex'), card(1, 'Dusknoir')], rules);
  assert.deepEqual(match, { id: 'dragapult-dusknoir', name: 'Dragapult Dusknoir', icons: ['dragapult', 'dusknoir'] });
});

test('only the newest generation is used', () => {
  const rules = compileDeckRules(LIMITLESS);
  assert.equal(matchDeckRules([card(1, 'Dragapult ex')], rules), null);
});

test('copies count on one line; prints split across lines do not add up', () => {
  const rules = compileDeckRules(LIMITLESS);
  const split = [card(1, 'Dragapult ex', 'TWM', '130'), card(1, 'Dragapult ex', 'PRE', '73')];
  assert.equal(matchDeckRules(split, rules), null);
});

test('a set on a rule card must match the deck card', () => {
  const rules = compileDeckRules(LIMITLESS);
  assert.equal(matchDeckRules([card(4, 'Dhelmise', 'PBL'), card(2, 'Banette', 'PBL')], rules)?.name, 'Dhelmise');
  assert.equal(matchDeckRules([card(4, 'Dhelmise', 'SSP'), card(2, 'Banette', 'PBL')], rules), null);
});

test('a priority tie goes to the rule asking for more copies', () => {
  const rules = compileDeckRules(LIMITLESS);
  const deck = [card(2, 'Mega Froslass ex'), card(2, 'Mega Lopunny ex'), card(3, 'Buneary')];
  assert.equal(matchDeckRules(deck, rules)?.name, 'Mega Lopunny');
});

test('our own rules sort among Limitless rules by priority', () => {
  const own: DeckRule[] = [
    {
      identifier: 'jp-pult-kanga',
      name: 'Pult Kanga',
      icons: ['dragapult'],
      priority: 11,
      cards: [
        { name: 'Dragapult ex', count: '2' },
        { name: 'Mega Kangaskhan ex', count: '2' }
      ]
    }
  ];
  const rules = compileDeckRules(LIMITLESS, own);
  assert.equal(matchDeckRules([card(2, 'Dragapult ex'), card(2, 'Mega Kangaskhan ex')], rules)?.name, 'Pult Kanga');
  assert.equal(matchDeckRules([card(2, 'Dragapult ex')], rules)?.name, 'Dragapult');
});

test('icons are keyed by every name a rule can give', () => {
  const icons = deckRuleIcons(compileDeckRules(LIMITLESS));
  assert.deepEqual(icons.Dragapult, ['dragapult']);
  assert.deepEqual(icons['Dragapult Dusknoir'], ['dragapult', 'dusknoir']);
  assert.equal(icons['Dragapult (old)'], undefined);
});

function deck(archetype: string, cards: GatheredDeck['cards']): GatheredDeck {
  return {
    id: archetype,
    archetype,
    archetypeId: archetype,
    archetypeSource: 'limitless-icons',
    cards
  } as GatheredDeck;
}

const pokemon = (count: number, name: string) => ({ ...card(count, name), category: 'pokemon' as const });

test('City League decks take Standard names and keep icon names when no rule matches', async () => {
  const rules = await loadCityLeagueRules(async () => LIMITLESS, assert.fail);
  const named = nameCityLeagueDecks(
    [
      deck('Dragapult Dusknoir', [pokemon(3, 'Dragapult ex'), pokemon(2, 'Dusknoir')]),
      deck('Mega Kangaskhan Mega Rayquaza', [pokemon(4, 'Mega Kangaskhan ex'), pokemon(2, 'Mega Rayquaza ex')]),
      deck('Mega Kangaskhan Ogerpon', [
        pokemon(4, 'Mega Kangaskhan ex'),
        pokemon(3, 'Teal Mask Ogerpon ex'),
        pokemon(2, 'Raging Bolt ex')
      ]),
      deck('Rogue Thing', [pokemon(4, 'Pikachu')])
    ],
    rules
  );
  assert.deepEqual(
    named.decks.map(entry => [entry.archetype, entry.archetypeSource]),
    [
      ['Dragapult Dusknoir', 'limitless-rules'],
      ['Mega Rayquaza', 'limitless-rules'],
      ['Basic Box', 'limitless-rules'],
      ['Rogue Thing', 'limitless-icons']
    ]
  );
  assert.deepEqual(named.icons['Mega Rayquaza'], ['rayquaza-mega']);
});

test('without Limitless rules, our own still apply and the failure is reported', async () => {
  const warnings: string[] = [];
  const rules = await loadCityLeagueRules(
    async () => 'Invalid Access Key',
    message => warnings.push(message)
  );
  const named = nameCityLeagueDecks([deck('Dragapult', [pokemon(3, 'Dragapult ex')])], rules);
  assert.equal(named.decks[0].archetype, 'Dragapult');
  assert.equal(named.decks[0].archetypeSource, 'limitless-icons');
  assert.equal(warnings.length, 1);
});
