/**
 * Reprint collapsing in the card-movers trend report (D20).
 *
 * `buildCardTrendReport` canonicalizes each deck card through the synonym
 * database so "reprints (e.g. same card in two sets) collapse into a single
 * trend entry instead of splitting appearances + share" — its own words. It
 * assembled the lookup key by interpolating the deck card's fields, and deck
 * artifacts carry RAW collector numbers (`TWM/95`) while the synonym database
 * keys UIDs zero-padded (`TWM/095`). 547 of the database's 2,295 entries have a
 * leading zero, so the lookup missed all of them.
 *
 * Measured on a 25-deck sample from one archetype: 4 of 11 reprint mappings
 * missed (Bastiodon, Budew, Judge, Poké Pad).
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';

import { buildCardTrendReport } from '../../shared/onlineMeta/index.ts';
import type { SynonymDatabase } from '../../shared/data/cardIdentity.ts';

const tournaments = [
  { id: 't1', name: 'T1', date: '2026-01-01', players: 20, deckTotal: 20, format: 'STANDARD' },
  { id: 't2', name: 'T2', date: '2026-01-15', players: 20, deckTotal: 20, format: 'STANDARD' },
  { id: 't3', name: 'T3', date: '2026-01-29', players: 20, deckTotal: 20, format: 'STANDARD' }
];

/** Budew ASC/004 is a reprint of Budew PRE/004 — both numbers below 100. */
const SYNONYMS: SynonymDatabase = {
  synonyms: { 'Budew::ASC::004': 'Budew::PRE::004' },
  canonicals: { Budew: 'Budew::PRE::004' }
};

/**
 * One deck per tournament running each printing, with the collector number in
 * the shape a real decks.json carries it: unpadded.
 */
function decksRunningBothPrintings() {
  const deck = (tournamentId: string, set: string, number: string | number) => ({
    tournamentId,
    archetype: 'A',
    successTags: [],
    cards: [{ name: 'Budew', set, number, count: 1 }]
  });
  return [
    ...Array.from({ length: 3 }, () => deck('t1', 'PRE', 4)),
    ...Array.from({ length: 3 }, () => deck('t1', 'ASC', 4)),
    ...Array.from({ length: 9 }, () => deck('t3', 'PRE', 4)),
    ...Array.from({ length: 9 }, () => deck('t3', 'ASC', 4))
  ];
}

describe('card trend reprint collapsing', () => {
  it('collapses a reprint whose collector number is below 100 (D20)', () => {
    const report = buildCardTrendReport(
      decksRunningBothPrintings() as never,
      tournaments as never,
      {
        minAppearances: 1,
        topCount: 10,
        synonymDb: SYNONYMS
      } as never
    );

    const budew = [...report.rising, ...report.falling].filter(c => c.name === 'Budew');
    assert.strictEqual(budew.length, 1, `Budew split across printings: ${budew.map(c => c.key).join(', ')}`);
    assert.strictEqual(budew[0].key, 'Budew::PRE::004', 'must collapse onto the canonical printing');
  });

  it('still collapses a reprint whose collector number is three digits', () => {
    // The case that always worked — pinned so a fix for the short numbers does
    // not regress it.
    const db: SynonymDatabase = {
      synonyms: { 'Nest Ball::SUM::123': 'Nest Ball::SVI::181' },
      canonicals: {}
    };
    const deck = (tournamentId: string, set: string, number: string) => ({
      tournamentId,
      archetype: 'A',
      successTags: [],
      cards: [{ name: 'Nest Ball', set, number, count: 1 }]
    });
    const decks = [
      ...Array.from({ length: 3 }, () => deck('t1', 'SVI', '181')),
      ...Array.from({ length: 3 }, () => deck('t1', 'SUM', '123')),
      ...Array.from({ length: 9 }, () => deck('t3', 'SVI', '181')),
      ...Array.from({ length: 9 }, () => deck('t3', 'SUM', '123'))
    ];

    const report = buildCardTrendReport(
      decks as never,
      tournaments as never,
      {
        minAppearances: 1,
        topCount: 10,
        synonymDb: db
      } as never
    );

    const nestBall = [...report.rising, ...report.falling].filter(c => c.name === 'Nest Ball');
    assert.strictEqual(nestBall.length, 1);
    assert.strictEqual(nestBall[0].key, 'Nest Ball::SVI::181');
  });

  it('leaves genuinely distinct cards separate', () => {
    const deck = (tournamentId: string, name: string, set: string, number: number) => ({
      tournamentId,
      archetype: 'A',
      successTags: [],
      cards: [{ name, set, number, count: 1 }]
    });
    const decks = [
      ...Array.from({ length: 3 }, () => deck('t1', 'Budew', 'PRE', 4)),
      ...Array.from({ length: 9 }, () => deck('t3', 'Budew', 'PRE', 4)),
      ...Array.from({ length: 3 }, () => deck('t1', 'Ralts', 'PAF', 27)),
      ...Array.from({ length: 9 }, () => deck('t3', 'Ralts', 'PAF', 27))
    ];

    const report = buildCardTrendReport(
      decks as never,
      tournaments as never,
      {
        minAppearances: 1,
        topCount: 10,
        synonymDb: SYNONYMS
      } as never
    );

    const keys = new Set([...report.rising, ...report.falling].map(c => c.key));
    assert.ok(keys.has('Budew::PRE::004'));
    assert.ok(keys.has('Ralts::PAF::027'));
  });

  it('emits zero-padded keys regardless of how the deck spelled the number', () => {
    const deck = (tournamentId: string, number: string | number) => ({
      tournamentId,
      archetype: 'A',
      successTags: [],
      cards: [{ name: 'Budew', set: 'PRE', number, count: 1 }]
    });
    const decks = [
      ...Array.from({ length: 3 }, () => deck('t1', 4)),
      ...Array.from({ length: 3 }, () => deck('t1', '004')),
      ...Array.from({ length: 9 }, () => deck('t3', '4')),
      ...Array.from({ length: 9 }, () => deck('t3', '04'))
    ];

    const report = buildCardTrendReport(
      decks as never,
      tournaments as never,
      {
        minAppearances: 1,
        topCount: 10
      } as never
    );

    const budew = [...report.rising, ...report.falling].filter(c => c.name === 'Budew');
    assert.strictEqual(budew.length, 1, `one printing spelled four ways split into ${budew.length} rows`);
    assert.strictEqual(budew[0].key, 'Budew::PRE::004');
  });
});
