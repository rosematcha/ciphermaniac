// Shared sample data — Regional Championship Prague top 20
export const TOURNAMENT = {
  name: 'Regional Championship Prague',
  short: 'Prague Regionals',
  date: '2026-04-12',
  location: 'Prague, CZ',
  decks: 1367,
  format: 'Standard'
};

export const CARDS = [
  { rank: 1, name: 'Night Stretcher', set: 'SFA', number: '61', found: 1253, total: 1367, pct: 91.66, type: 'trainer' },
  { rank: 2, name: "Boss's Orders", set: 'PAL', number: '172', found: 1238, total: 1367, pct: 90.56, type: 'trainer' },
  {
    rank: 3,
    name: "Lillie's Determination",
    set: 'JTG',
    number: '175',
    found: 1222,
    total: 1367,
    pct: 89.39,
    type: 'trainer'
  },
  { rank: 4, name: 'Poké Pad', set: 'JTG', number: '162', found: 1177, total: 1367, pct: 86.1, type: 'trainer' },
  { rank: 5, name: 'Ultra Ball', set: 'SVI', number: '196', found: 1081, total: 1367, pct: 79.08, type: 'trainer' },
  {
    rank: 6,
    name: 'Buddy-Buddy Poffin',
    set: 'PRE',
    number: '101',
    found: 896,
    total: 1367,
    pct: 65.54,
    type: 'trainer'
  },
  { rank: 7, name: 'Fezandipiti ex', set: 'SFA', number: '92', found: 854, total: 1367, pct: 62.47, type: 'pokemon' },
  { rank: 8, name: 'Meowth ex', set: 'PRE', number: '124', found: 771, total: 1367, pct: 56.4, type: 'pokemon' },
  { rank: 9, name: 'Psychic Energy', set: 'SVE', number: '5', found: 676, total: 1367, pct: 49.45, type: 'energy' },
  { rank: 10, name: 'Unfair Stamp', set: 'TWM', number: '165', found: 669, total: 1367, pct: 48.94, type: 'trainer' },
  { rank: 11, name: 'Munkidori', set: 'TWM', number: '95', found: 637, total: 1367, pct: 46.6, type: 'pokemon' },
  { rank: 12, name: 'Darkness Energy', set: 'SVE', number: '7', found: 622, total: 1367, pct: 45.5, type: 'energy' },
  { rank: 13, name: 'Budew', set: 'PRE', number: '4', found: 617, total: 1367, pct: 45.14, type: 'pokemon' },
  { rank: 14, name: 'Crispin', set: 'SCR', number: '133', found: 583, total: 1367, pct: 42.65, type: 'trainer' },
  { rank: 15, name: 'Judge', set: 'SVI', number: '176', found: 541, total: 1367, pct: 39.58, type: 'trainer' },
  {
    rank: 16,
    name: "Lillie's Clefairy ex",
    set: 'JTG',
    number: '56',
    found: 538,
    total: 1367,
    pct: 39.36,
    type: 'pokemon'
  },
  { rank: 17, name: 'Fire Energy', set: 'SVE', number: '2', found: 450, total: 1367, pct: 32.92, type: 'energy' },
  { rank: 18, name: 'Rare Candy', set: 'SVI', number: '191', found: 434, total: 1367, pct: 31.75, type: 'trainer' },
  { rank: 19, name: 'Dreepy', set: 'TWM', number: '128', found: 423, total: 1367, pct: 30.94, type: 'pokemon' },
  { rank: 20, name: 'Drakloak', set: 'TWM', number: '129', found: 423, total: 1367, pct: 30.94, type: 'pokemon' }
];

export const IMG_BASE = 'https://ciphermaniac.com/thumbnails/sm';

export function imgUrl(card) {
  return `${IMG_BASE}/${card.set}/${card.number}`;
}
