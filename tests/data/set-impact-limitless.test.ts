/**
 * Reading Limitless's Day 2 database for Set Impact: the page markup we
 * depend on, which events count, the common depth every event is cut to, and
 * folding Limitless's print tables into our synonyms.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cutToDepth,
  extendSynonyms,
  isEligible,
  type LimitlessDeck,
  parseDecklists,
  parseEventInfo,
  parsePrintTable,
  toImpactDecks
} from '../../shared/setImpact/limitless.ts';

test('the infobox gives name, date, size and format', () => {
  const html = `<div class="infobox-heading"> Special Event Bilbao <img></div>
    <div class="infobox-line"> 7th May 2022 • 276 Players • <a href="/decks/?time=all&amp;format=SSH-BRS">SSH - BRS</a></div>`;
  assert.deepEqual(parseEventInfo(303, html), {
    id: 303,
    name: 'Special Event Bilbao',
    format: 'SSH-BRS',
    players: 276,
    date: '2022-05-07'
  });
  assert.deepEqual(parseEventInfo(570, '<div class="infobox-heading">CL Chiba<'), {
    id: 570,
    name: 'CL Chiba',
    format: null,
    players: null,
    date: null
  });
});

const card = (set: string, number: string, count: number, name: string) =>
  `<div class="decklist-card" data-set="${set}" data-number="${number}" data-lang="en" ><a><span class="card-count">${count}</span> <span class="card-name">${name}</span></a></div>`;

test('decklists come out with their placing and cards', () => {
  const html = `<section><div class="tournament-decklist"><div class="decklist-toggle" data-toggle data-target="decklist-1">1st Someone</div>
      ${card('SSH', '179', 4, 'Quick Ball')}${card('BRS', '132', 2, 'Boss&#039;s Orders')}</div>
    <div class="tournament-decklist"><div class="decklist-toggle" data-toggle data-target="decklist-2">22nd Another</div>
      ${card('FST', '237', 1, 'Quick Ball')}</div></section>`;
  assert.deepEqual(parseDecklists(html), [
    {
      place: 1,
      cards: [
        ['Quick Ball', 'SSH', '179', 4],
        ["Boss's Orders", 'BRS', '132', 2]
      ]
    },
    { place: 22, cards: [['Quick Ball', 'FST', '237', 1]] }
  ]);
});

test('the print table lists international printings only', () => {
  const html = `<table class="card-prints-versions"><tr><th>Int. Prints</th></tr>
    <tr><td><a href="/cards/SSH/179">SSH <span>#179</span></a></td></tr>
    <tr><td><a href="/cards/FST/237">FST</a></td></tr>
    <tr><th>JP. Prints</th></tr><tr><td><a href="/cards/S1W/60">S1W</a></td></tr></table>`;
  assert.deepEqual(parsePrintTable(html), ['SSH::179', 'FST::237']);
  assert.deepEqual(parsePrintTable('<p>no table</p>'), []);
});

test('only dated, sized, international-format, non-online events count', () => {
  const base = { id: 1, name: 'Regional X', format: 'SSH-BRS', players: 300, date: '2022-05-07' };
  const dated = (code: string) => ['SSH', 'BST'].includes(code);
  assert.equal(isEligible(base, dated, '2026-09-22'), true);
  assert.equal(isEligible({ ...base, format: 'TEU-CRE' }, dated, '2026-09-22'), false);
  assert.equal(isEligible({ ...base, format: null }, dated, '2026-09-22'), false);
  assert.equal(isEligible({ ...base, players: null }, dated, '2026-09-22'), false);
  assert.equal(isEligible({ ...base, date: '2027-02-19' }, dated, '2026-09-22'), false);
  assert.equal(isEligible({ ...base, name: 'Limitless Online Series' }, dated, '2026-09-22'), false);
});

const decks = (places: number[]): LimitlessDeck[] => places.map(place => ({ place, cards: [] }));
const DEPTH = { depth: 0.05, minDecks: 8, minCoverage: 0.95 };

test('every event is cut to the same share of its field', () => {
  // Top 5% of 276 is 14 placings; Bilbao listed 31.
  const bilbao = cutToDepth(decks(Array.from({ length: 31 }, (_, i) => i + 1)), 276, DEPTH);
  assert.equal(bilbao?.length, 14);
  // Lists that stop short of the cut leave the event out.
  assert.equal(cutToDepth(decks([1, 2, 3, 4, 5, 6, 7, 8]), 276, DEPTH), null);
  // So does a field too small to reach eight decks.
  assert.equal(cutToDepth(decks([1, 2, 3, 4, 5, 6, 7, 8]), 100, DEPTH), null);
  // One missing list in twenty is tolerated.
  const nineteen = Array.from({ length: 20 }, (_, i) => i + 1).filter(place => place !== 7);
  assert.equal(cutToDepth(decks(nineteen), 400, DEPTH)?.length, 19);
});

test('Limitless decks convert to builder decks', () => {
  assert.deepEqual(toImpactDecks([{ place: 3, cards: [['Quick Ball', 'SSH', '179', 4]] }]), [
    { placement: 3, cards: [{ name: 'Quick Ball', set: 'SSH', number: '179' }] }
  ]);
});

test('print tables fold into our synonyms, joining known clusters', () => {
  const db = { synonyms: { 'Switch::SVI::194': 'Switch::MEG::130' }, canonicals: {} };
  const extended = extendSynonyms(
    db,
    new Map([
      ['Quick Ball::SSH::179', ['SSH::179', 'FST::237']],
      ['Switch::SSH::183', ['SSH::183', 'SVI::194']],
      ['Quick Ball::FST::237', ['SSH::179', 'FST::237']]
    ])
  );
  assert.equal(extended.synonyms['Quick Ball::FST::237'], 'Quick Ball::SSH::179');
  assert.equal('Quick Ball::SSH::179' in extended.synonyms, false);
  assert.equal(extended.synonyms['Switch::SSH::183'], 'Switch::MEG::130');
  assert.equal(extended.synonyms['Switch::SVI::194'], 'Switch::MEG::130');
});
