/**
 * Per-format canonical prints: each format names a card by its own legal sets.
 *
 * Print tables are the live synonym DB's clusters (2026-10-28) with their
 * scraped prices; expectations were agreed with Reese.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  makeFormatChooser,
  makeFormatResolver,
  type PrintVariation,
  type SynonymDatabase
} from '../../shared/data/canonicalPrint.ts';
import { FORMAT_SCOPES, type FormatCanon } from '../../shared/formats/registry.ts';

type Row = [set: string, number: string, price: number | null];

const PRINTS: Record<string, Row[]> = {
  Budew: [
    ['ASC', '016', 0.19],
    ['ASC', '221', 6.27],
    ['PRE', '004', 0.2]
  ],
  'Dark Tyranitar': [
    ['30C', 'CC9', 12.42],
    ['TRR', '019', 79.67]
  ],
  'Dedenne-GX': [
    ['UNB', '057', 18.12],
    ['UNB', '195', 32.91],
    ['UNB', '195A', 22.62],
    ['UNB', '219', 49.36]
  ],
  'Energy Recycler': [
    ['AOR', '072', 0.23],
    ['BST', '124', 0.11],
    ['DRI', '164', 0.23],
    ['FLI', '143', 35.65],
    ['GRI', '123', 0.31],
    ['POR', '108', 1.64]
  ],
  'Escape Rope': [
    ['BST', '125', 0.26],
    ['BUS', '114', 0.29],
    ['BUS', '163', 17.4],
    ['PLS', '120', 0.41],
    ['PRC', '127', 0.27]
  ],
  Iono: [
    ['PAF', '080', 0.21],
    ['PAF', '237', 23.36],
    ['PAL', '185', 0.29],
    ['PAL', '254', 10.47],
    ['PAL', '269', 47.14],
    ['SVP', '124', 11.78]
  ],
  'Level Ball': [
    ['AOR', '076', 0.36],
    ['BST', '129', 0.23],
    ['BST', '181', 6.03],
    ['NXD', '089', 0.73]
  ],
  'Lightning Energy': [
    ['BLW', '108', 4.52],
    ['BRS', 'L', null],
    ['BS2', '128', 0.33],
    ['BS', '100', 0.48],
    ['CL', '091', 40],
    ['CRZ', '155', 2.03],
    ['DP', '126', 18.65],
    ['E1', '163', 1.2],
    ['EM', '104', 13.91],
    ['EVO', '094', 0.21],
    ['EVS', '235', 8.92],
    ['GEN', '078', 0.51],
    ['HP', '108', 8.29],
    ['MEE', '004', 0.19],
    ['MEE', '012', 0.14],
    ['PK', '106', 5.83],
    ['RS', '109', 0.35],
    ['SSH', 'L', 0.18],
    ['SVE', '004', 0.15],
    ['SVE', '012', 0.18],
    ['SVI', '257', 3.28],
    ['XY', '135', 0.76]
  ],
  'Nest Ball': [
    ['PAF', '084', 0.24],
    ['SUM', '123', 0.39],
    ['SUM', '158', 8.84],
    ['SVI', '181', 0.23],
    ['SVI', '255', 3.08]
  ],
  Pecharunt: [
    ['SVP', '129', 1.64],
    ['SVP', '149', 0.83]
  ],
  'Quick Ball': [
    ['FST', '237', 0.17],
    ['MD', '086', 0.56],
    ['MT', '114', 0.5],
    ['SSH', '179', 0.31],
    ['SSH', '216', 10.73]
  ],
  'Rare Candy': [
    ['CES', '142', 0.39],
    ['CRZ', '141', 0.24],
    ['DEX', '100', 1.37],
    ['EM', '083', 7.3],
    ['GE', '102', 6.73],
    ['GRI', '165', 25.34],
    ['HP', '090', 10.36],
    ['MEG', '125', 0.21],
    ['MEG', '175', 3.66],
    ['P5', '007', 25.66],
    ['P8', '010', 7.84],
    ['PAF', '089', 0.19],
    ['PGO', '069', 0.24],
    ['PLB', '085', 0.72],
    ['PLB', '105', 231.25],
    ['PRC', '135', 0.47],
    ['SS', '088', 8.16],
    ['SSH', '180', 0.33],
    ['SUM', '129', 0.29],
    ['SVI', '191', 0.22],
    ['SVI', '256', 5.68],
    ['UL', '082', 8.94]
  ],
  "Rocket's Admin.": [
    ['CEL', 'CC12', 0.5],
    ['TRR', '086', 21.96]
  ],
  'Mew VMAX': [
    ['30C', 'CC28', 23.21],
    ['FST', '114', 16.49],
    ['FST', '268', 91.95],
    ['FST', '269', 233.19],
    ['LOR', 'TG30', 30.36]
  ],
  'Professor Burnet': [
    ['SIT', 'TG26', 4.32],
    ['SP', '167', 0.28]
  ],
  'Training Court': [
    ['FST', '282', 2.16],
    ['RCL', '169', 0.23]
  ],
  'VS Seeker': [
    ['PHF', '109', 4.5],
    ['RG', '100', 5.54],
    ['ROS', '110', 18.95],
    ['SV', '140', 5.19]
  ],
  'Warp Energy': [
    ['CIN', '123', 4.56],
    ['E2', '147', 8.08],
    ['PK', '091', 2.02],
    ['SF', '095', 2.73],
    ['SLG', '070', 0.32],
    ['UF', '100', 2.41]
  ]
};

/** The print each format should name, as `SET NUMBER`. */
const EXPECTED: Record<string, Record<string, string>> = {
  rspk: {
    'Rare Candy': 'SS 088',
    "Rocket's Admin.": 'TRR 086',
    'Warp Energy': 'UF 100',
    'Lightning Energy': 'E1 163',
    'Dark Tyranitar': 'TRR 019'
  },
  efg: {
    'Nest Ball': 'SVI 181',
    'Escape Rope': 'BST 125',
    'Energy Recycler': 'BST 124',
    'Level Ball': 'BST 129',
    'Quick Ball': 'FST 237',
    Iono: 'PAL 185',
    'Rare Candy': 'PGO 069',
    'Lightning Energy': 'BRS L',
    'Professor Burnet': 'SP 167',
    'Training Court': 'FST 282'
  },
  expanded: {
    'Rare Candy': 'MEG 125',
    'Quick Ball': 'FST 237',
    'VS Seeker': 'PHF 109',
    Iono: 'PAL 185',
    'Nest Ball': 'SVI 181',
    'Escape Rope': 'BST 125',
    'Energy Recycler': 'DRI 164',
    'Lightning Energy': 'MEE 004',
    'Warp Energy': 'SLG 070',
    Budew: 'PRE 004',
    'Dedenne-GX': 'UNB 057',
    Pecharunt: 'SVP 129',
    'Mew VMAX': 'FST 114'
  },
  eternal: {
    'Rare Candy': 'MEG 125',
    'Quick Ball': 'FST 237',
    'VS Seeker': 'PHF 109',
    Iono: 'PAL 185',
    'Nest Ball': 'SVI 181',
    'Lightning Energy': 'MEE 004',
    "Rocket's Admin.": 'TRR 086',
    'Dark Tyranitar': 'TRR 019',
    Budew: 'PRE 004'
  }
};

function variations(name: string): PrintVariation[] {
  return PRINTS[name].map(([set, number, price]) => ({ set, number, price_usd: price }));
}

function canonOf(id: string): FormatCanon {
  const canon = FORMAT_SCOPES.find(format => format.id === id)?.canon;
  assert.ok(canon, `${id} has a canonical policy`);
  return canon;
}

for (const [id, cards] of Object.entries(EXPECTED)) {
  test(`${id} names each card by its own policy`, () => {
    const choose = makeFormatChooser(canonOf(id));
    for (const [name, expected] of Object.entries(cards)) {
      const chosen = choose(variations(name), name);
      assert.equal(chosen && `${chosen.set} ${chosen.number}`, expected, `${id}: ${name}`);
    }
  });
}

test('a print from a set the catalog lacks names a card only when nothing else does', () => {
  const choose = makeFormatChooser(canonOf('eternal'));
  const prints = [
    { set: 'ZZZ', number: '001', price_usd: 0.1 },
    { set: 'PAL', number: '185', price_usd: 0.29 }
  ];
  assert.deepEqual(choose(prints, 'Iono'), prints[1]);
  assert.deepEqual(choose([prints[0]], 'Iono'), prints[0]);
});

test('City Leagues keeps the Standard canonical', () => {
  assert.equal(FORMAT_SCOPES.find(format => format.id === 'city-leagues')?.canon, undefined);
});

test('a chooser handed no prints names nothing', () => {
  assert.equal(makeFormatChooser(canonOf('expanded'))([], 'Iono'), null);
});

test('a set range the catalog cannot order is rejected', () => {
  assert.throws(() => makeFormatChooser({ sets: { oldest: 'PAF', newest: 'BST' }, prefer: 'oldest' }), /PAF-BST/);
  assert.throws(() => makeFormatChooser({ sets: { oldest: 'RS', newest: 'NOPE' }, prefer: 'oldest' }), /RS-NOPE/);
});

test('the format resolver re-chooses from the whole cluster, from any member', () => {
  const db: SynonymDatabase = {
    synonyms: {
      'Iono::PAL::185': 'Iono::SVP::124',
      'Iono::PAF::080': 'Iono::SVP::124'
    },
    canonicals: { Iono: 'Iono::SVP::124' },
    prints: { 'Iono::SVP::124': 11.78, 'Iono::PAL::185': 0.29, 'Iono::PAF::080': 0.21 }
  };
  const resolve = makeFormatResolver(db, canonOf('eternal'));
  assert.equal(resolve('Iono::PAF::080'), 'Iono::PAL::185');
  assert.equal(resolve('Iono::SVP::124'), 'Iono::PAL::185');
  assert.equal(resolve('Iono'), 'Iono::PAL::185');
  assert.equal(resolve('Unknown Card::XXX::001'), 'Unknown Card::XXX::001');
  assert.equal(resolve(''), '');
});
