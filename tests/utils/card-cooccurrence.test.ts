import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCardId, type Deck } from '../../shared/clientSideFiltering.ts';
import { buildCooccurrence, findComplements, findSubstituteQuestions } from '../../shared/cardCooccurrence.ts';

// Stable collector numbers per single-letter card label.
const NUM: Record<string, string> = { S: '1', X: '2', Y: '3', P: '4', Q: '5', A: '6', B: '7', C: '8', M: '9', N: '10' };
const idOf = (name: string) => buildCardId('TST', NUM[name]);
const card = (name: string) => ({ name, set: 'TST', number: NUM[name], count: 1 });
const makeDeck = (id: string, names: string[]): Deck => ({ id, archetype: 'Test', cards: names.map(card) }) as Deck;

function optionIds(q: { options: { cardId: string }[] }): string[] {
  return q.options.map(o => o.cardId).sort();
}

// 20 decks: S in all (staple), X|Y a perfect 50/50 split with no overlap,
// P (75%) and Q (70%) heavily co-occur with each other and with the first half.
function mainDecks(): Deck[] {
  const decks: Deck[] = [];
  for (let i = 0; i < 20; i += 1) {
    const names = ['S', i < 10 ? 'X' : 'Y'];
    if (i < 15) {
      names.push('P');
    }
    if (i < 14) {
      names.push('Q');
    }
    decks.push(makeDeck(`d${i}`, names));
  }
  return decks;
}

test('buildCooccurrence counts deck presence per card', () => {
  const ctx = buildCooccurrence(mainDecks(), []);
  assert.equal(ctx.totalDecks, 20);
  assert.equal(ctx.presence.get(idOf('S'))?.count, 20);
  assert.equal(ctx.presence.get(idOf('X'))?.count, 10);
  assert.equal(ctx.presence.get(idOf('P'))?.count, 15);
});

test('findSubstituteQuestions flags the 50/50 split and ignores staples/complements', () => {
  const ctx = buildCooccurrence(mainDecks(), []);
  const questions = findSubstituteQuestions(ctx);

  assert.equal(questions.length, 1);
  assert.deepEqual(optionIds(questions[0]), [idOf('X'), idOf('Y')].sort());
  assert.equal(questions[0].coverage, 1);
  assert.equal(questions[0].lift, 0);
  // The universal staple S is never offered as a choice.
  assert.ok(!questions.some(q => q.options.some(o => o.cardId === idOf('S'))));
  // P/Q co-occur heavily → never a substitute pair.
  assert.ok(!questions.some(q => optionIds(q).includes(idOf('P')) && optionIds(q).includes(idOf('Q'))));
});

test('findSubstituteQuestions stays silent on tiny subsets', () => {
  const decks = [makeDeck('a', ['X']), makeDeck('b', ['Y'])];
  assert.deepEqual(findSubstituteQuestions(buildCooccurrence(decks, [])), []);
});

test('findSubstituteQuestions collapses a mutual-exclusion triangle into one question', () => {
  const decks: Deck[] = [];
  for (let i = 0; i < 21; i += 1) {
    const names = ['S', i < 7 ? 'A' : i < 14 ? 'B' : 'C'];
    decks.push(makeDeck(`t${i}`, names));
  }
  const questions = findSubstituteQuestions(buildCooccurrence(decks, []));
  assert.equal(questions.length, 1);
  assert.equal(questions[0].options.length, 3);
  assert.deepEqual(optionIds(questions[0]), [idOf('A'), idOf('B'), idOf('C')].sort());
});

test('findSubstituteQuestions ranks the most balanced, highest-coverage pair first', () => {
  // 24 decks: X|Y a clean 50/50; M (≈46%) tracks the X half, N (≈33%) the Y half.
  const decks: Deck[] = [];
  for (let i = 0; i < 24; i += 1) {
    const names = ['S', i < 12 ? 'X' : 'Y'];
    if (i < 11) {
      names.push('M');
    }
    if (i >= 12 && i < 20) {
      names.push('N');
    }
    decks.push(makeDeck(`r${i}`, names));
  }
  const questions = findSubstituteQuestions(buildCooccurrence(decks, []));
  assert.ok(questions.length >= 1);
  assert.deepEqual(optionIds(questions[0]), [idOf('X'), idOf('Y')].sort());
  for (let k = 0; k + 1 < questions.length; k += 1) {
    assert.ok(questions[k].strength >= questions[k + 1].strength);
  }
});

test('findComplements favours niche partners and drops archetype staples', () => {
  // ctx is the *filtered* subset (decks already conditioned on the pick P).
  // X and Y both appear in every filtered deck, but their archetype-wide
  // baselines differ wildly: X is rare (niche), Y is an everyone-plays-it staple.
  const filtered: Deck[] = [];
  for (let i = 0; i < 10; i += 1) {
    filtered.push(makeDeck(`f${i}`, ['P', 'X', 'Y']));
  }
  const ctx = buildCooccurrence(filtered, []);
  const baselinePct = new Map([
    [idOf('P'), 0.1],
    [idOf('X'), 0.1], // rare overall → distinctive
    [idOf('Y'), 0.9] // staple → excluded
  ]);
  const complements = findComplements(ctx, [idOf('P')], { baselinePct });

  assert.deepEqual(
    complements.map(c => c.ref.cardId),
    [idOf('X')]
  );
  assert.ok(complements[0].lift > 9); // 1.0 / 0.1
  assert.equal(complements[0].basePct, 0.1);
});

test('findComplements ranks the more distinctive partner first', () => {
  const filtered: Deck[] = [];
  for (let i = 0; i < 10; i += 1) {
    filtered.push(makeDeck(`g${i}`, ['P', 'X', 'M']));
  }
  const ctx = buildCooccurrence(filtered, []);
  const baselinePct = new Map([
    [idOf('P'), 0.1],
    [idOf('X'), 0.1], // lift 10
    [idOf('M'), 0.5] // lift 2
  ]);
  const complements = findComplements(ctx, [idOf('P')], { baselinePct });
  assert.deepEqual(
    complements.map(c => c.ref.cardId),
    [idOf('X'), idOf('M')]
  );
});

test('findComplements labels cards from the report when provided', () => {
  const ctx = buildCooccurrence(mainDecks(), [
    { cardId: idOf('Q'), name: 'Fancy Reported Name', set: 'TST', number: NUM.Q, category: 'trainer/item' }
  ]);
  const complements = findComplements(ctx, [idOf('P')]);
  const q = complements.find(c => c.ref.cardId === idOf('Q'));
  assert.equal(q?.ref.name, 'Fancy Reported Name');
  assert.equal(q?.ref.category, 'trainer/item');
});
