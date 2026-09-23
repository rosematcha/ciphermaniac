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
  placementWeight,
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

test('placement weight is ln(field / place) and averages to about 1', () => {
  assert.equal(placementWeight(1, 100), Math.log(100));
  assert.equal(placementWeight(100, 100), 0);
  assert.equal(placementWeight(150, 100), 0);
  assert.equal(placementWeight(null, 100), 1);
  const field = 2000;
  let sum = 0;
  for (let place = 1; place <= field; place++) {
    sum += placementWeight(place, field);
  }
  assert.ok(Math.abs(sum / field - 1) < 0.01);
});

function deck(placement: number, ...cards: string[]): ImpactDeck {
  return {
    placement,
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
        deck(1, 'Ultra Ball::MEG::131', 'Ultra Ball::BRS::150', 'Fire Energy::SVE::002'),
        deck(2, 'Ultra Ball::MEG::131'),
        deck(3, 'Counter Catcher::CIN::091'),
        deck(4, 'Counter Catcher::CIN::091')
      ]
    },
    attributor.canonical
  );
  assert.deepEqual([...shares.keys()].sort(), ['Counter Catcher::CIN::091', 'Ultra Ball::MEG::131']);
  assert.equal(shares.get('Ultra Ball::MEG::131')?.linear, 0.5);
  // The winners' card outweighs the one that finished 3rd and 4th.
  const ball = shares.get('Ultra Ball::MEG::131')?.weighted ?? 0;
  const catcher = shares.get('Counter Catcher::CIN::091')?.weighted ?? 0;
  assert.ok(ball > 0.5 && catcher < 0.5);
  assert.ok(Math.abs(ball + catcher - 1) < 1e-9);
});

test('the builder sums cards per set and projects rotation from the dominant mark', () => {
  const builder = createSetImpactBuilder(DB, MARKS);
  builder.addEvent({
    date: '2024-09-13',
    name: 'Before',
    players: 2,
    decks: [deck(1, 'Ultra Ball::MEG::131', 'Counter Catcher::CIN::091'), deck(2, 'Counter Catcher::CIN::091')]
  });
  builder.addEvent({
    date: '2025-10-10',
    name: 'After',
    players: 2,
    decks: [deck(1, 'Ultra Ball::MEG::131'), deck(2, 'Budew::PRE::004')]
  });
  const payload = builder.finish('2026-09-22T00:00:00.000Z');
  const byCode = new Map(payload.sets.map(set => [set.code, set]));

  const brs = byCode.get('BRS');
  assert.deepEqual(brs?.events, [0]);
  assert.deepEqual(brs?.series.legal.linear, [0.5]);
  assert.deepEqual(brs?.series.new.linear, [0.5]);

  const svi = byCode.get('SVI');
  assert.deepEqual(svi?.events, [0, 1]);
  assert.deepEqual(svi?.series.legal.linear, [0, 0.5]);
  // Only the winner ran it, and last place weighs nothing.
  assert.deepEqual(svi?.series.legal.weighted, [0, 1]);
  assert.deepEqual(svi?.series.new.linear, [0, 0]);
  assert.deepEqual(svi?.cards, [
    { name: 'Ultra Ball', set: 'SVI', number: '196', isNew: false, linear: 0.25, weighted: 0.5 }
  ]);

  const par = byCode.get('PAR');
  assert.deepEqual(par?.series.legal.linear, [1, 0]);
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
    decks: [{ placement: 1, cards: [{ name: "Boss's Orders", set: 'SP', number: '250' }] }]
  });
  assert.equal(
    builder.finish('2026-09-22T00:00:00.000Z').sets.some(set => set.code === 'SP'),
    false
  );
});
