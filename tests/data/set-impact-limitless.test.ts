/**
 * Reading Limitless's Day 2 database for Set Impact: the page markup we
 * depend on, which events count, the common depth every event is cut to, and
 * folding Limitless's print tables into our synonyms.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cutToTop,
  eraWindows,
  extendSynonyms,
  isStandardEvent,
  type LimitlessDeck,
  parseDecklists,
  parseEventInfo,
  parsePrintTable,
  parseSetList,
  seasonFirstSet,
  secondFridayAfter,
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
      ${card('FST', '237', 1, 'Quick Ball')}${card('LOT', '232', 1, 'Tapu Koko <span style="font-family:ptcg-font" data-tooltip="Prism Star">&#9826;</span>')}</div></section>`;
  assert.deepEqual(parseDecklists(html), [
    {
      place: 1,
      cards: [
        ['Quick Ball', 'SSH', '179', 4],
        ["Boss's Orders", 'BRS', '132', 2]
      ]
    },
    {
      place: 22,
      cards: [
        ['Quick Ball', 'FST', '237', 1],
        ['Tapu Koko ♢', 'LOT', '232', 1]
      ]
    }
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

test('events count only in the Standard of their day', () => {
  const base = { id: 1, name: 'Regional X', format: 'SSH-BRS', players: 300, date: '2022-05-07' };
  const today = '2026-09-22';
  assert.equal(isStandardEvent(base, today), true);
  // A BLW-on label in 2018 is Expanded.
  assert.equal(isStandardEvent({ ...base, format: 'BLW-CES', date: '2018-10-06' }, today), false);
  // Unlabelled events count before Limitless labelled formats, never after.
  assert.equal(isStandardEvent({ ...base, format: null, date: '2014-08-16' }, today), true);
  assert.equal(isStandardEvent({ ...base, format: null, date: '2023-02-25' }, today), false);
  assert.equal(isStandardEvent({ ...base, players: null }, today), false);
  assert.equal(isStandardEvent({ ...base, date: '2027-02-19' }, today), false);
  assert.equal(isStandardEvent({ ...base, name: 'Limitless Online Series' }, today), false);
});

test('seasons follow the rotation table', () => {
  assert.equal(seasonFirstSet('2016-10-15'), 'PRC');
  assert.equal(seasonFirstSet('2017-08-31'), 'PRC');
  assert.equal(seasonFirstSet('2017-09-01'), 'BKT');
  assert.equal(seasonFirstSet('2026-09-19'), 'TEF');
  assert.equal(seasonFirstSet('2001-01-01'), null);
});

test('a set is legal from its second Friday until its season rotates', () => {
  // SUM came out Friday 3 Feb 2017: the next Friday is the 10th, legal the 17th.
  assert.equal(secondFridayAfter('2017-02-03'), '2017-02-17');
  assert.equal(secondFridayAfter('2017-02-01'), '2017-02-10');
  const sets = [
    { code: 'PRC', name: 'Primal Clash', released: '2015-02-04' },
    { code: 'BKT', name: 'BREAKthrough', released: '2015-11-04' },
    { code: 'ROS', name: 'Roaring Skies', released: '2015-05-06' },
    { code: 'SSH', name: 'Sword & Shield', released: '2020-02-07' },
    { code: 'SMP', name: 'Promos', released: null }
  ];
  const windows = new Map(eraWindows(sets, '2020-02-07').map(window => [window.code, window]));
  assert.deepEqual(windows.get('ROS'), {
    code: 'ROS',
    name: 'Roaring Skies',
    legalFrom: '2015-05-15',
    legalUntil: '2017-09-01'
  });
  // SUM, which really rotated BKT, isn't in this list, so the next season it
  // holds (SSH's) closes the window.
  assert.equal(windows.get('BKT')?.legalUntil, '2022-02-25');
  assert.equal(windows.has('SSH'), false);
  assert.equal(windows.has('SMP'), false);
});

test('the set list gives code, name and release date', () => {
  const html = `<tr><td><a href="/cards/SUM">Sun &amp; Moon <span>SUM</span> 03 Feb 17</a></td></tr>
    <tr><td><a href="/cards/SMP">Sun &amp; Moon Promos <span>SMP</span></a></td></tr>`;
  assert.deepEqual(parseSetList(html), [
    { code: 'SUM', name: 'Sun & Moon', released: '2017-02-03' },
    { code: 'SMP', name: 'Sun & Moon Promos', released: null }
  ]);
});

const decks = (places: number[]): LimitlessDeck[] => places.map(place => ({ place, cards: [] }));

test('every event is cut to its top 8', () => {
  assert.equal(cutToTop(decks(Array.from({ length: 31 }, (_, i) => i + 1)))?.length, 8);
  // Ties at the cut keep every tied list.
  assert.equal(cutToTop(decks([1, 2, 3, 3, 5, 5, 5, 5, 9]))?.length, 8);
  assert.equal(cutToTop(decks([1, 2, 3, 4, 5, 6, 7]), 8), null);
  assert.equal(cutToTop(decks([1, 2, 3, 4, 5, 6, 7, 12])), null);
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
