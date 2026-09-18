/**
 * New-set seeding for the synonyms scrape: which sets count as new, and the
 * card list parsed from a Limitless set page.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { newSetCodes, parseSetCardList } from '../../.github/scripts/lib/setSeeds.ts';

test('a set not legal yet is new', () => {
  assert.ok(newSetCodes('2026-09-18').includes('30C'));
});

test('a set legal within the window is new, an older one is not', () => {
  const codes = newSetCodes('2026-07-15');
  assert.ok(codes.includes('CRI'));
  assert.ok(!codes.includes('POR'));
});

test('sets without a legality window never seed', () => {
  assert.ok(!newSetCodes('2026-09-18', 100_000).includes('BS'));
});

const ROW = (number: string, name: string) => `
  <tr data-hover="x.png">
    <td><span class="card-set"><img class="set" alt="30C">30C</span></td>
    <td><a href="/cards/30C/${number}">${number}</a></td>
    <td><a href="/cards/30C/${number}">${name}</a></td>
    <td class="md-only"><a href="/cards/30C/${number}"><span class="ptcg-symbol">P</span> Basic</a></td>
    <td> <a class="card-price usd" href="https://partner.tcgplayer.com/x">$1.00</a> </td>
  </tr>`;

test('parses number and name from each row', () => {
  const html = `<table><tr><th>Set</th><th>No.</th></tr>${ROW('66', 'Mew ex')}${ROW('152', 'Mew ex')}${ROW('G', 'Mew')}</table>`;
  assert.deepEqual(parseSetCardList(html, '30C'), [
    { name: 'Mew ex', number: '66' },
    { name: 'Mew ex', number: '152' },
    { name: 'Mew', number: 'G' }
  ]);
});

test('ignores rows for other sets', () => {
  const html = `<table>${ROW('66', 'Mew ex')}</table>`;
  assert.deepEqual(parseSetCardList(html, 'CRI'), []);
});
