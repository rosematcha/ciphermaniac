import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  parseCardName,
  parseDecklistPage,
  parseEventPage,
  parseJpCardPrints,
  parseListingPage
} from '../../.github/scripts/lib/cityLeagues/parse';

// Real Limitless pages saved 2026-10-27.
const fixture = (name: string) => readFileSync(new URL(`../fixtures/city-leagues/${name}`, import.meta.url), 'utf8');

test('listing: every event row with its id, day, prefecture and shop', () => {
  const page = parseListingPage(fixture('listing.html'));
  assert.equal(page.rows.length, 25);
  assert.equal(page.maxPage, 206);
  assert.deepEqual(page.rows[0], {
    id: '5150',
    date: '2026-10-27',
    prefecture: 'Kanagawa',
    shop: '【CARDBOX】青馬堂矢向店'
  });
  assert.equal(page.rows.at(-1)?.date, '2026-10-18');
  // Newest day first. Ids don't follow the days: 5086 (10-21) is listed above 5087 (10-20).
  const dates = page.rows.map(row => row.date);
  assert.deepEqual(dates, [...dates].sort().reverse());
});

test('event page: heading, official result id and sixteen placings', () => {
  const event = parseEventPage(fixture('event-5150.html'));
  assert.equal(event.name, 'City League Kanagawa 10/27');
  assert.equal(event.officialId, '1115224');
  assert.equal(event.placings.length, 16);
  assert.deepEqual(event.placings[0], {
    placing: 1,
    player: 'みぞれ',
    playerId: '0052099566',
    listId: '76771',
    icons: ['kangaskhan-mega', 'talonflame']
  });
  assert.deepEqual(
    event.placings.map(placing => placing.placing),
    Array.from({ length: 16 }, (_, index) => index + 1)
  );
  // Two finishers registered the same list, so Limitless shows one id for both.
  assert.equal(event.placings[12].listId, '74842');
  assert.equal(event.placings[15].listId, '74842');
});

test('decklist: counts, sections, and Japanese-only cards marked by their /cards/jp link', () => {
  const list = parseDecklistPage(fixture('decklist-76771.html'), '76771');
  assert.equal(list.id, '76771');
  assert.equal(
    list.cards.reduce((total, card) => total + card.count, 0),
    60
  );
  assert.deepEqual(list.cards[0], {
    count: 4,
    name: 'Mega Kangaskhan ex',
    set: 'MEG',
    number: '104',
    category: 'pokemon',
    jp: false
  });
  const jp = list.cards.filter(card => card.jp);
  assert.deepEqual(
    jp.map(card => `${card.count} ${card.name} ${card.set}/${card.number} ${card.category}`),
    [
      '3 Talonflame ex M6/62 pokemon',
      '2 Mega Rayquaza ex M6/58 pokemon',
      '1 Adventuring Lantern M6/64 trainer',
      '2 Legendary Lava Cave M6/75 trainer',
      '2 Legendary Lava Cave M6/76 trainer'
    ]
  );
  const energy = list.cards.filter(card => card.category === 'energy');
  assert.deepEqual(
    energy.map(card => card.name),
    ['Fire Energy', 'Lightning Energy']
  );
});

test('unreleased Japanese card page: no English print, and its other Japanese print', () => {
  const prints = parseJpCardPrints(fixture('card-jp-M6-62.html'), { set: 'M6', number: '62' });
  assert.deepEqual(prints, {
    international: [],
    japanese: [
      { set: 'M6', number: '62' },
      { set: 'M6', number: '96' }
    ]
  });
});

test('released Japanese card page: its English prints under Int. Prints', () => {
  const prints = parseJpCardPrints(fixture('card-jp-M6a-15.html'), { set: 'M6a', number: '15' });
  assert.deepEqual(prints.international, [
    { set: 'MEP', number: '99' },
    { set: '30C', number: '21' },
    { set: '30C', number: '148' }
  ]);
  assert.deepEqual(prints.japanese, [
    { set: 'MP', number: '151' },
    { set: 'M6a', number: '15' }
  ]);
});

test('card name off an English card page', () => {
  assert.equal(parseCardName(fixture('card-en-30C-21.html')), 'Greninja ex');
  assert.equal(parseCardName('<html></html>'), null);
});
