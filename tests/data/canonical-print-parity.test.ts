/**
 * Parity corpus for canonical-print selection.
 *
 * DB-MASTER-PLAN Phase 2 slice 1 ports `.github/scripts/lib/canonical-print.mjs`
 * to `shared/data/canonicalPrint.ts`. The `.mjs` stays as the runtime for its
 * ESM producer (`update-card-synonyms.mjs`, which cannot import TypeScript)
 * until that producer migrates. Every scenario below runs through BOTH
 * implementations and asserts they choose the identical print, plus the
 * expected print, so the two can only be retired once proven equal.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { chooseCanonicalPrint as chooseNew } from '../../shared/data/canonicalPrint.ts';
import { chooseCanonicalPrint as chooseOld, type PrintVariation } from '../../.github/scripts/lib/canonical-print.mjs';

function print(set: string, number: string, price: number | null): PrintVariation {
  // eslint-disable-next-line camelcase -- price_usd mirrors the scraped print-table shape
  return { set, number, price_usd: price };
}

interface Scenario {
  label: string;
  cardName: string;
  variations: PrintVariation[];
  /** Event date for rolling-canonical scenarios; omitted = current-legality behavior. */
  asOfDate?: string;
  expected: [string, string] | null;
}

// Boss's Orders full Limitless print table; the rolling scenarios below walk
// it through three real events and must land on three different canonicals.
const BOSSS_ORDERS_PRINTS: PrintVariation[] = [
  print('SP', '251', 13.57),
  print('RCL', '154', 1.35),
  print('RCL', '189', 67.04),
  print('RCL', '200', 46.56),
  print('SHF', '058', 0.31),
  print('BRS', '132', 0.44),
  print('LOR', 'TG24', 10.96),
  print('PAL', '172', 0.32),
  print('PAL', '248', 11.18),
  print('PAL', '265', 19.95),
  print('MEG', '114', 0.25),
  print('ASC', '183', 0.23),
  print('ASC', '256', 8.05)
];

// Real print tables scraped from Limitless plus synthetic edge cases; the same
// corpus the Python and .mjs unit tests exercise, chooser expectations agreed
// with Reese.
const CORPUS: Scenario[] = [
  {
    label: 'standard-legal filtering + oldest cheap Pokemon print',
    // Dreepy: ASC 247 is a collector print; TWM is the oldest cheap legal print.
    cardName: 'Dreepy',
    variations: [
      print('TWM', '128', 0.24),
      print('PRE', '071', 0.15),
      print('ASC', '158', 0.19),
      print('ASC', '247', 10.68)
    ],
    expected: ['TWM', '128']
  },
  {
    label: 'excludes rotated prints and secret rares',
    // Boss's Orders: everything before MEG has rotated; ASC 256 is a secret rare.
    cardName: "Boss's Orders",
    variations: [
      print('SP', '251', 13.57),
      print('RCL', '154', 1.35),
      print('RCL', '189', 67.04),
      print('RCL', '200', 46.56),
      print('SHF', '058', 0.31),
      print('BRS', '132', 0.44),
      print('LOR', 'TG24', 10.96),
      print('PAL', '172', 0.32),
      print('PAL', '248', 11.18),
      print('PAL', '265', 19.95),
      print('MEG', '114', 0.25),
      print('ASC', '183', 0.23),
      print('ASC', '256', 8.05)
    ],
    expected: ['MEG', '114']
  },
  {
    label: 'takes a lone legal print regardless of age',
    // Pokegear 3.0: only the Black Bolt print is still standard legal.
    cardName: 'Pokegear 3.0',
    variations: [
      print('HS', '096', 11.78),
      print('UNB', '182B', 2.25),
      print('UNB', '182A', 26.99),
      print('UNB', '182', 0.95),
      print('UNB', '233', 47.12),
      print('SSH', '174', 0.34),
      print('SVI', '186', 0.32),
      print('BLK', '084', 0.29)
    ],
    expected: ['BLK', '084']
  },
  {
    label: 'basic energy takes the newest cheap print (age rule inverted)',
    // Fire Energy: gold prints (CRZ/OBF) and rotated sets drop out; the
    // newest cheap legal print (MEE) beats the SVE energy-set prints.
    cardName: 'Fire Energy',
    variations: [
      print('BS', '098', 0.37),
      print('EVO', '092', 0.29),
      print('SUM', 'R', 0.17),
      print('TEU', 'R', 0.14),
      print('SSH', 'R', 0.28),
      print('FST', '284', 6.34),
      print('BRS', 'R', null),
      print('CRZ', '153', 3.59),
      print('SVE', '002', 0.19),
      print('SVE', '010', 0.11),
      print('SVE', '018', 0.19),
      print('OBF', '230', 3.55),
      print('MEE', '002', 0.22)
    ],
    expected: ['MEE', '002']
  },
  {
    label: 'affordability cap drops an expensive promo for a cheap set print',
    // Psyduck: the original Mega Promos print is priced out of reach, so the
    // accessible Ascended Heroes print is canonical despite being newer.
    cardName: 'Psyduck',
    variations: [print('MEP', '007', 10.91), print('ASC', '039', 0.26), print('ASC', '226', 83.72)],
    expected: ['ASC', '039']
  },
  {
    label: 'promo-only card takes the most accessible promo',
    // Pecharunt: promo-only, so the cheap promo wins over the older one.
    cardName: 'Pecharunt',
    variations: [print('SVP', '129', 2.05), print('SVP', '149', 0.76)],
    expected: ['SVP', '149']
  },
  {
    label: 'age tie-breaker keeps the affordable original over a newer reprint',
    // Poke Pad: the original ASC print settled back to a reasonable price, so
    // it beats the newer POR reprint; POR 113 is a collector print.
    cardName: 'Poke Pad',
    variations: [print('ASC', '198', 0.43), print('POR', '081', 0.3), print('POR', '113', 12.82)],
    expected: ['ASC', '198']
  },
  {
    label: 'strikes unpriced prints when priced alternatives exist',
    cardName: 'Some Card',
    variations: [print('MEG', '050', null), print('ASC', '010', 0.3)],
    expected: ['ASC', '010']
  },
  {
    label: 'falls back to the oldest legal print when nothing has a price',
    cardName: 'Some Card',
    variations: [print('MEG', '050', null), print('ASC', '010', null)],
    expected: ['MEG', '050']
  },
  {
    label: 'still picks a canonical for fully rotated cards',
    cardName: "Boss's Orders",
    variations: [print('RCL', '154', 1.35), print('BRS', '132', 0.44)],
    expected: ['BRS', '132']
  },
  {
    label: 'price tie broken by lower collector number',
    // Two legal prints at identical price and identical release index (same
    // set) resolve to the lower collector number.
    cardName: 'Tie Card',
    variations: [print('ASC', '158', 0.19), print('ASC', '042', 0.19)],
    expected: ['ASC', '042']
  },
  {
    label: 'empty variation list yields null in both implementations',
    cardName: 'Nonexistent',
    variations: [],
    expected: null
  },

  // Rolling canonicals: legality evaluated on the event date. Acceptance cases
  // agreed with Reese (2026-07-14).
  {
    label: 'rolling: Nest Ball at San Antonio 2023 is the SVI print, not the rotated SUM one',
    // Dateless, the whole cluster is rotated today and falls back to the
    // oldest print (SUM 123) — the sibling scenario below pins that too.
    cardName: 'Nest Ball',
    variations: [print('SUM', '123', 0.21), print('SVI', '181', 0.15), print('PAF', '084', 0.11)],
    asOfDate: '2023-11-18',
    expected: ['SVI', '181']
  },
  {
    label: 'rolling: Nest Ball without a date falls back to the oldest print (fully rotated today)',
    cardName: 'Nest Ball',
    variations: [print('SUM', '123', 0.21), print('SVI', '181', 0.15), print('PAF', '084', 0.11)],
    expected: ['SUM', '123']
  },
  {
    label: 'rolling: Poke Pad at Houston 2026 ignores the not-yet-released POR reprint',
    cardName: 'Poke Pad',
    variations: [print('ASC', '198', 0.43), print('POR', '081', 0.3), print('POR', '113', 12.82)],
    asOfDate: '2026-02-28',
    expected: ['ASC', '198']
  },
  {
    label: "rolling: Boss's Orders at Baltimore 2023 (post-2023 rotation) is BRS 132",
    cardName: "Boss's Orders",
    variations: BOSSS_ORDERS_PRINTS,
    asOfDate: '2023-07-15',
    expected: ['BRS', '132']
  },
  {
    label: "rolling: Boss's Orders at Monterrey 2025 (post-2025 rotation) is PAL 172",
    cardName: "Boss's Orders",
    variations: BOSSS_ORDERS_PRINTS,
    asOfDate: '2025-05-17',
    expected: ['PAL', '172']
  },
  {
    label: "rolling: Boss's Orders at NAIC 2026 (post-2026 rotation) is MEG 114",
    cardName: "Boss's Orders",
    variations: BOSSS_ORDERS_PRINTS,
    asOfDate: '2026-06-13',
    expected: ['MEG', '114']
  },
  {
    label: 'rolling: basic energy takes the newest print legal on the event date',
    // Fire Energy at a 2024 event: MEE does not exist yet, so the SVE energy
    // set wins; within it the regular print (lowest number) beats the
    // transiently cheaper reverse variant.
    cardName: 'Fire Energy',
    variations: [
      print('SSH', 'R', 0.28),
      print('FST', '284', 6.34),
      print('SVE', '002', 0.19),
      print('SVE', '010', 0.11),
      print('SVE', '018', 0.19),
      print('MEE', '002', 0.22)
    ],
    asOfDate: '2024-01-01',
    expected: ['SVE', '002']
  },
  {
    label: 'rolling: unpriced energies still land on the energy set, not the bling reprint',
    // Baltimore 2024 regression: with no prices anywhere (TCGCSV carries no
    // modern energy prints), the accessibility cap cannot strike the gold
    // OBF 230, and OBF is newer than SVE — the energy-set preference must
    // decide, and the regular SVE 002 wins over its variants.
    cardName: 'Fire Energy',
    variations: [
      print('SVE', '002', null),
      print('SVE', '010', null),
      print('SVE', '018', null),
      print('OBF', '230', null),
      print('PAL', '278', null)
    ],
    asOfDate: '2024-09-13',
    expected: ['SVE', '002']
  },
  {
    label: 'rolling: a meta-spiked regular print beats a cheaper collector version',
    // Baltimore 2024 regression (Pidgeot ex): the illustration rare OBF 217
    // was cheaper on the event date than the meta-spiked regular OBF 164.
    // Below the accessibility cap the collector number decides, not price.
    cardName: 'Pidgeot ex',
    variations: [
      print('OBF', '164', 8.76),
      print('OBF', '217', 5.57),
      print('OBF', '225', 10.97),
      print('PAF', '221', 5.91)
    ],
    asOfDate: '2024-09-13',
    expected: ['OBF', '164']
  },
  {
    label: 'rolling: fully rotated at the event date falls back to prints that existed then',
    // A 2023 event where every existing print has rotated: the fallback pool
    // is prints that existed on the date, so the future MEG reprint (cheapest
    // of the three) must not win.
    cardName: 'Some Card',
    variations: [print('RCL', '020', 0.3), print('SHF', '011', 0.25), print('MEG', '001', 0.1)],
    asOfDate: '2023-07-15',
    expected: ['RCL', '020']
  }
];

describe('canonical-print parity (old .mjs vs new TS port)', () => {
  for (const scenario of CORPUS) {
    it(scenario.label, () => {
      const options = scenario.asOfDate ? { asOfDate: scenario.asOfDate } : undefined;
      const oldResult = chooseOld(scenario.variations, scenario.cardName, options);
      const newResult = chooseNew(scenario.variations, scenario.cardName, options);

      // The whole point of the slice: the two implementations must agree.
      assert.deepEqual(newResult, oldResult, 'TS port must match the .mjs implementation exactly');

      if (scenario.expected === null) {
        assert.equal(newResult, null);
        assert.equal(oldResult, null);
      } else {
        assert.ok(newResult, 'expected a canonical print');
        assert.deepEqual([newResult.set, newResult.number], scenario.expected);
      }
    });
  }

  it('both implementations reject a malformed asOfDate', () => {
    const variations = [print('ASC', '198', 0.43)];
    assert.throws(() => chooseOld(variations, 'Poke Pad', { asOfDate: '2026/02/28' }));
    assert.throws(() => chooseNew(variations, 'Poke Pad', { asOfDate: '2026/02/28' }));
  });
});
