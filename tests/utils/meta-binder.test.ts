import test from 'node:test';
import assert from 'node:assert/strict';

import { type BinderArchetypeInput, binderChecklist, buildBinder } from '../../src/lib/metaBinder.ts';
import type { CardItem } from '../../src/types/index.ts';

/** Card at a given inclusion, with a copy histogram that averages to `copies`. */
function card(name: string, pct: number, extra: Partial<CardItem> = {}, copies = 4): CardItem {
  return {
    name,
    uid: `${name}::TST::001`,
    set: 'TST',
    number: '001',
    found: pct,
    total: 100,
    pct,
    dist: [{ copies, players: 100, percent: 100 }],
    ...extra
  };
}

function archetype(base: string, deckCount: number, items: CardItem[]): BinderArchetypeInput {
  return { base, label: base, deckCount, items };
}

const POKEMON: Partial<CardItem> = { category: 'pokemon' };
const SUPPORTER: Partial<CardItem> = { category: 'trainer', trainerType: 'supporter' };
const ITEM: Partial<CardItem> = { category: 'trainer', trainerType: 'item' };

/** Every card the binder placed, across sections and archetype groups. */
function allCards(result: ReturnType<typeof buildBinder>) {
  return [...result.sections.flatMap(s => s.cards), ...result.archetypeGroups.flatMap(g => g.cards)];
}

function sectionCards(result: ReturnType<typeof buildBinder>, key: string): string[] {
  return result.sections.find(s => s.key === key)?.cards.map(c => c.name) ?? [];
}

test('a Pokémon core to three archetypes becomes a staple', () => {
  // Played at 100% in three of four archetypes → deckShare 0.75, comfortably
  // over the 0.22 floor, and the second-best ratio is 1.0.
  const staple = () => card('Squawkabilly ex', 100, POKEMON);
  const result = buildBinder([
    archetype('A', 100, [staple()]),
    archetype('B', 100, [staple()]),
    archetype('C', 100, [staple()]),
    archetype('D', 100, [])
  ]);
  assert.deepStrictEqual(sectionCards(result, 'staplePokemon'), ['Squawkabilly ex']);
});

test('two archetypes is not enough to be a staple', () => {
  // Same card, one fewer archetype: below STAPLE_POKEMON_MIN_ARCHETYPES, so it
  // falls through to the archetype grouping instead.
  const shared = () => card('Squawkabilly ex', 100, POKEMON);
  const result = buildBinder([
    archetype('A', 100, [shared()]),
    archetype('B', 100, [shared()]),
    archetype('C', 100, [])
  ]);
  assert.deepStrictEqual(sectionCards(result, 'staplePokemon'), []);
  assert.strictEqual(result.archetypeGroups.length, 1);
  assert.deepStrictEqual(
    result.archetypeGroups[0].cards.map(c => c.name),
    ['Squawkabilly ex']
  );
});

test('a card core to three small archetypes misses the deck-share floor', () => {
  // Core to three archetypes, but they're tiny next to the rest of the field:
  // 300 of 3300 decks is 0.09, under CROSS_ARCH_MIN_DECK_SHARE. Being core to
  // three fringe decks doesn't make a card a staple of the format.
  const result = buildBinder([
    archetype('A', 100, [card('Fezandipiti ex', 100, POKEMON)]),
    archetype('B', 100, [card('Fezandipiti ex', 100, POKEMON)]),
    archetype('C', 100, [card('Fezandipiti ex', 100, POKEMON)]),
    archetype('Field', 3000, [])
  ]);
  assert.deepStrictEqual(sectionCards(result, 'staplePokemon'), []);
  // It falls back to its single strongest archetype rather than vanishing —
  // and appears once, not once per archetype that plays it.
  assert.strictEqual(result.archetypeGroups.length, 1);
  assert.deepStrictEqual(
    result.archetypeGroups[0].cards.map(c => c.name),
    ['Fezandipiti ex']
  );
});

test('a card too thin to matter in any archetype is ignored', () => {
  // 2% of 100 decks = 2 decks, under MIN_DECKS_PER_ARCHETYPE. Without this
  // floor a lone tech copy reads as a real inclusion rate.
  const result = buildBinder([archetype('A', 100, [card('Lone Tech', 2, ITEM), card('Nest Ball', 90, ITEM)])]);
  assert.deepStrictEqual(
    allCards(result).map(c => c.name),
    ['Nest Ball']
  );
});

test('a Pokémon under the core ratio everywhere is dropped, not orphaned', () => {
  const result = buildBinder([
    archetype('A', 100, [card('Random Tech', 20, POKEMON)]),
    archetype('B', 100, [card('Random Tech', 10, POKEMON)])
  ]);
  assert.deepStrictEqual(allCards(result), []);
  assert.strictEqual(result.cardCount, 0);
});

test('no card is ever placed in two sections', () => {
  const result = buildBinder([
    archetype('A', 500, [
      card('Boss', 80, SUPPORTER),
      card('Ball', 95, ITEM),
      card('Cape', 40, { category: 'trainer', trainerType: 'tool' }),
      card('Park', 30, { category: 'trainer', trainerType: 'stadium' }),
      card('Jet', 25, { category: 'energy', energyType: 'special' }),
      card('Mon', 100, POKEMON)
    ]),
    archetype('B', 300, [card('Boss', 70, SUPPORTER), card('Mon', 90, POKEMON)])
  ]);
  const names = allCards(result).map(c => c.name);
  assert.strictEqual(new Set(names).size, names.length, `duplicate placement: ${names.join(', ')}`);
  assert.deepStrictEqual(sectionCards(result, 'frequentItems'), ['Ball']);
  assert.deepStrictEqual(sectionCards(result, 'tools'), ['Cape']);
  assert.deepStrictEqual(sectionCards(result, 'stadiums'), ['Park']);
  assert.deepStrictEqual(sectionCards(result, 'specialEnergy'), ['Jet']);
});

test('deck share is weighted by archetype size, not averaged across archetypes', () => {
  // 100% of 900 decks + 0% of 100 decks = 0.9 overall, not the 0.5 a naive
  // mean of the two percentages would give.
  const result = buildBinder([archetype('Big', 900, [card('Ultra Ball', 100, ITEM)]), archetype('Small', 100, [])]);
  const [placed] = sectionCards(result, 'frequentItems');
  assert.strictEqual(placed, 'Ultra Ball');
  const found = result.sections.find(s => s.key === 'frequentItems')!.cards[0];
  assert.ok(Math.abs(found.deckShare - 0.9) < 1e-9, `expected 0.9, got ${found.deckShare}`);
});

test('supporters split on global rate or multi-archetype core usage', () => {
  const result = buildBinder([
    // 10% of 1000 decks: under the 0.25 global rate and core nowhere.
    archetype('A', 1000, [card('Iono', 10, SUPPORTER), card('Arven', 100, SUPPORTER)]),
    archetype('B', 1000, [card('Arven', 100, SUPPORTER)])
  ]);
  assert.deepStrictEqual(sectionCards(result, 'nicheSupporters'), ['Iono']);
  assert.deepStrictEqual(sectionCards(result, 'frequentSupporters'), ['Arven']);
});

test('copies come off the distribution and basic energy is excluded', () => {
  const result = buildBinder([
    archetype('A', 100, [
      card('Nest Ball', 100, ITEM, 2),
      card('Basic Fire Energy', 100, { category: 'energy', energyType: 'basic' }, 8),
      // No energyType at all — still energy, still basic, still excluded.
      card('Basic Water Energy', 100, { category: 'energy' }, 6)
    ])
  ]);
  const names = allCards(result).map(c => c.name);
  assert.deepStrictEqual(names, ['Nest Ball']);
  assert.strictEqual(allCards(result)[0].copies, 2);
  assert.strictEqual(result.copyCount, 2);
});

test('an empty selection returns empty sections rather than throwing', () => {
  const result = buildBinder([]);
  assert.strictEqual(result.cardCount, 0);
  assert.strictEqual(result.totalDecks, 0);
  assert.ok(result.sections.length > 0, 'sections should still be enumerated');
  assert.deepStrictEqual(result.archetypeGroups, []);
  // Archetypes with no decks must not divide by zero either.
  assert.strictEqual(buildBinder([archetype('A', 0, [card('X', 100, ITEM)])]).cardCount, 0);
});

test('the checklist prints copy counts and skips empty sections', () => {
  const result = buildBinder([archetype('A', 100, [card('Nest Ball', 100, ITEM, 3)])]);
  const text = binderChecklist(result);
  assert.match(text, /FREQUENT ITEMS/);
  assert.match(text, /3x Nest Ball \(TST 001\)/);
  assert.doesNotMatch(text, /STADIUMS/);
});
