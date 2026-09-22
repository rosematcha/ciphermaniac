/**
 * Crediting cards to sets for the Set Impact tool.
 *
 * Decklists name a global canonical print, so which set a card counts for is
 * decided here from its printings, the event date and each print's regulation
 * mark. The cases below are the ones that decide it: a staple handed from set
 * to set across rotations, a card brought back after rotating out, a reprint
 * entering the day its twin rotated, promos, and marks that rotate out of a
 * set that stays.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cardShares,
  createAttributor,
  createSetImpactBuilder,
  type ImpactDeck,
  majorWeights,
  type RegulationMarks
} from '../../shared/setImpact/build.ts';
import type { SynonymDatabase } from '../../shared/data/cardIdentity.ts';

const DB: SynonymDatabase = {
  synonyms: {
    'Ultra Ball::DEX::102': 'Ultra Ball::MEG::131',
    'Ultra Ball::BRS::150': 'Ultra Ball::MEG::131',
    'Ultra Ball::SVI::196': 'Ultra Ball::MEG::131',
    'Counter Catcher::PAR::160': 'Counter Catcher::CIN::091',
    'Crushing Hammer::SVI::168': 'Crushing Hammer::POR::081',
    'Budew::SVP::200': 'Budew::PRE::004',
    'Psyduck::MEP::007': 'Psyduck::ASC::039',
    'Earthen Vessel::PRE::106': 'Earthen Vessel::PAR::163'
  },
  canonicals: {}
};

const MARKS: RegulationMarks = {
  'BRS::150': 'F',
  'SVI::196': 'G',
  'MEG::131': 'I',
  'MEG::001': 'I',
  'MEG::002': 'I',
  'MEG::003': 'H',
  'SVI::168': 'G',
  'POR::081': 'J',
  'PAR::160': 'G',
  'PAR::163': 'G',
  // A G-mark reprint in a set that stays legal after the G rotation.
  'PRE::106': 'G',
  'PRE::004': 'H',
  'ASC::039': 'I'
};

const credit = (uid: string, date: string) => {
  const attributor = createAttributor(DB, MARKS);
  return attributor.credit(attributor.canonical(uid), date);
};

test('a staple is credited to whichever set is keeping it legal', () => {
  assert.equal(credit('Ultra Ball::MEG::131', '2024-09-13')?.set, 'BRS');
  assert.equal(credit('Ultra Ball::MEG::131', '2025-05-02')?.set, 'SVI');
  assert.equal(credit('Ultra Ball::MEG::131', '2026-05-08')?.set, 'MEG');
});

test('only the printing that brought a card into Standard is new', () => {
  // DEX predates the catalog's legality windows, so BRS introduced it.
  assert.equal(credit('Ultra Ball::MEG::131', '2024-09-13')?.isNew, true);
  assert.equal(credit('Ultra Ball::MEG::131', '2025-05-02')?.isNew, false);
  assert.equal(credit('Ultra Ball::MEG::131', '2026-05-08')?.isNew, false);
});

test('a reprint of a card out of Standard counts as new', () => {
  assert.deepEqual(credit('Counter Catcher::CIN::091', '2024-09-13'), {
    uid: 'Counter Catcher::PAR::160',
    name: 'Counter Catcher',
    set: 'PAR',
    number: '160',
    isNew: true
  });
});

test('a reprint legal the day its twin rotated is not new', () => {
  // SVI's G mark and POR's legality both land on 2026-04-10.
  const hammer = credit('Crushing Hammer::POR::081', '2026-05-08');
  assert.equal(hammer?.set, 'POR');
  assert.equal(hammer?.isNew, false);
});

test('the regulation mark decides legality, not the set', () => {
  // PRE is legal after April 2026, but its G-mark Earthen Vessel is not.
  assert.equal(credit('Earthen Vessel::PAR::163', '2026-01-24')?.set, 'PAR');
  assert.equal(credit('Earthen Vessel::PAR::163', '2026-05-08'), null);
});

test('promos lose to a set printing, but win when they are the only one', () => {
  assert.equal(credit('Budew::PRE::004', '2025-05-02')?.set, 'PRE');
  // Psyduck was a promo before ASC was legal.
  assert.equal(credit('Psyduck::ASC::039', '2026-01-24')?.set, 'MEP');
  assert.equal(credit('Psyduck::ASC::039', '2026-02-27')?.set, 'ASC');
});

test('a printing from a set that was never legal credits nobody', () => {
  assert.equal(credit('Ultra Ball::DEX::102', '2013-01-01'), null);
});

test('a major stands for the time around it, up to the reach, within the legal window', () => {
  const year = (days: number) => days / 365.25;
  // Ten days apart: each takes half the gap, plus the reach on the outside.
  assert.deepEqual(majorWeights(['2024-06-01', '2024-06-11'], '2024-01-01', '2025-01-01', 30), [year(35), year(35)]);
  // A gap wider than twice the reach leaves the middle uncovered.
  const [first, second] = majorWeights(['2024-06-01', '2024-12-01'], '2024-01-01', '2025-01-01', 30);
  assert.ok(Math.abs(first - year(60)) < 1e-9);
  assert.ok(Math.abs(second - year(60)) < 1e-9);
  // The window's edges clip the reach: a major on the set's first legal day
  // reaches back nowhere, and a set with no rotation reaches forward the full reach.
  assert.deepEqual(majorWeights(['2024-01-01'], '2024-01-01', '2024-01-11', 30), [year(10)]);
  assert.deepEqual(majorWeights(['2024-01-01'], '2024-01-01', null, 30), [year(30)]);
  assert.deepEqual(majorWeights([], '2024-01-01', null), []);
});

function deck(...cards: string[]): ImpactDeck {
  return {
    cards: cards.map(uid => {
      const [name, set, number] = uid.split('::');
      return { name, set, number };
    })
  };
}

test('card shares count a deck once per card and skip basic energy', () => {
  const attributor = createAttributor(DB, MARKS);
  const shares = cardShares(
    {
      date: '2024-09-13',
      name: 'Test',
      players: 4,
      decks: [
        deck('Ultra Ball::MEG::131', 'Ultra Ball::BRS::150', 'Fire Energy::SVE::002'),
        deck('Ultra Ball::MEG::131'),
        deck('Counter Catcher::CIN::091'),
        deck('Counter Catcher::CIN::091')
      ]
    },
    attributor.canonical
  );
  assert.deepEqual([...shares.keys()].sort(), ['Counter Catcher::CIN::091', 'Ultra Ball::MEG::131']);
  assert.equal(shares.get('Ultra Ball::MEG::131'), 0.5);
  assert.equal(shares.get('Counter Catcher::CIN::091'), 0.5);
});

test('the builder sums cards per set, weighs its majors and projects rotation from the dominant mark', () => {
  const builder = createSetImpactBuilder(DB, MARKS);
  builder.addEvent({
    date: '2024-09-13',
    name: 'Before',
    players: 2,
    decks: [deck('Ultra Ball::MEG::131', 'Counter Catcher::CIN::091'), deck('Counter Catcher::CIN::091')]
  });
  builder.addEvent({
    date: '2025-10-10',
    name: 'After',
    players: 2,
    decks: [deck('Ultra Ball::MEG::131'), deck('Budew::PRE::004')]
  });
  const payload = builder.finish('2026-09-22T00:00:00.000Z');
  const byCode = new Map(payload.sets.map(set => [set.code, set]));

  const brs = byCode.get('BRS');
  assert.deepEqual(brs?.events, [0]);
  assert.deepEqual(brs?.series.legal, [0.5]);
  assert.deepEqual(brs?.series.new, [0.5]);

  const svi = byCode.get('SVI');
  assert.deepEqual(svi?.events, [0, 1]);
  assert.deepEqual(svi?.series.legal, [0, 0.5]);
  assert.deepEqual(svi?.series.new, [0, 0]);
  // Two majors a year apart, each standing for 45 days either side.
  assert.deepEqual(svi?.weights, [0.2464, 0.2464]);
  // SVI's Ultra Ball only took over once BRS rotated: its share is over that
  // one major, not diluted over both.
  assert.deepEqual(svi?.cards, [
    { name: 'Ultra Ball', set: 'SVI', number: '196', isNew: false, share: 0.5, majors: 1 }
  ]);

  const par = byCode.get('PAR');
  assert.deepEqual(par?.series.legal, [1, 0]);
  assert.deepEqual(par?.cards, [
    { name: 'Counter Catcher', set: 'PAR', number: '160', isNew: true, share: 0.5, majors: 2 }
  ]);
  assert.equal(par?.rotatesOn, '2026-04-10');
  assert.equal(par?.rotationPredicted, false);

  // MEG's marks here are mostly I, so it is predicted to leave with I.
  const meg = byCode.get('MEG');
  assert.equal(meg?.rotatesOn, '2028-04-14');
  assert.equal(meg?.rotationPredicted, true);
  assert.equal(meg?.legalYears, 2.51);

  // Promo and energy sets are never ranked; sets with no event are dropped.
  assert.equal(byCode.has('SVP'), false);
  assert.equal(byCode.has('SVE'), false);
  assert.equal(byCode.has('CRI'), false);
  assert.deepEqual(
    payload.sets.map(set => set.legalFrom),
    [...payload.sets.map(set => set.legalFrom)].sort()
  );
});

test('an extra window marks a reprint of a card still legal from an undated set', () => {
  const db: SynonymDatabase = { synonyms: { 'Switch::SSH::183': 'Switch::CEC::209' }, canonicals: {} };
  const plain = createAttributor(db, {});
  assert.equal(plain.credit('Switch::CEC::209', '2022-05-07')?.isNew, true);
  const dated = createAttributor(db, {}, [{ code: 'CEC', legalFrom: '2019-11-15', legalUntil: '2022-02-25' }]);
  const switchCard = dated.credit('Switch::CEC::209', '2022-05-07');
  assert.equal(switchCard?.set, 'SSH');
  assert.equal(switchCard?.isNew, false);
  // Before the rotation the dated set is the older legal print, and earns the credit.
  assert.equal(dated.credit('Switch::CEC::209', '2021-06-01')?.set, 'CEC');
});

test('a promo window credits last and never ranks', () => {
  const db: SynonymDatabase = { synonyms: { "Boss's Orders::SP::250": "Boss's Orders::RCL::154" }, canonicals: {} };
  const promos = [{ code: 'SP', legalFrom: '2019-11-15', legalUntil: '2025-04-11', promo: true }];
  const attributor = createAttributor(db, {}, promos);
  assert.equal(attributor.credit("Boss's Orders::RCL::154", '2022-05-07')?.set, 'RCL');
  const builder = createSetImpactBuilder(db, {}, promos);
  builder.addEvent({
    date: '2022-05-07',
    name: 'X',
    players: 1,
    decks: [{ cards: [{ name: "Boss's Orders", set: 'SP', number: '250' }] }]
  });
  assert.equal(
    builder.finish('2026-09-22T00:00:00.000Z').sets.some(set => set.code === 'SP'),
    false
  );
});
