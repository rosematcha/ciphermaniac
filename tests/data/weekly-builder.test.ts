/**
 * The weekly report: this week against last, from the trends deck window.
 *
 * Fixtures are built from a small calendar: `windowEnd` is 2026-09-11 00:00Z,
 * so the recent week is Sep 4 to 10 and the prior week Aug 28 to Sep 3. Lists
 * are placed with `day(n)` counting back from the end, so day(1) is Sep 10 and
 * day(8) is Sep 3.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { appendTrendHistory, buildWeeklyReport } from '../../shared/onlineMeta/index.ts';
import type { TrendDeckInput } from '../../shared/onlineMeta/types.ts';

const END = '2026-09-11T00:00:00.000Z';
const END_MS = Date.parse(END);

/** A timestamp `n` days before the window end, at noon UTC of that day. */
const day = (n: number): string => new Date(END_MS - n * 86_400_000 + 12 * 3_600_000).toISOString();

interface Card {
  name: string;
  set?: string;
  number?: string;
  count?: number;
}
const card = (name: string, set = 'SET', number = '001'): Card => ({ name, set, number, count: 1 });

const list = (daysAgo: number, archetype: string, cards: Card[] = [], top10 = false): TrendDeckInput => ({
  tournamentId: `t-${daysAgo}`,
  tournamentDate: day(daysAgo),
  archetype,
  successTags: top10 ? ['top10', 'top25'] : ['top50'],
  cards
});

/** `n` lists of `archetype` on the given day. */
const lists = (n: number, daysAgo: number, archetype: string, cards: Card[] = [], top10 = false): TrendDeckInput[] =>
  Array.from({ length: n }, () => list(daysAgo, archetype, cards, top10));

/** Loose floors so a handful of lists is enough for every section. */
const LOOSE = { windowEnd: END, minDayLists: 1, minDeckLists: 1, minDeckDayLists: 1, minMoverLists: 1 };

describe('buildWeeklyReport periods', () => {
  it('splits whole UTC days into the recent and prior weeks', () => {
    const report = buildWeeklyReport([...lists(3, 1, 'A'), ...lists(2, 8, 'A'), ...lists(9, 15, 'A')], LOOSE);
    assert.equal(report.recent.start, '2026-09-04');
    assert.equal(report.recent.end, '2026-09-11');
    assert.equal(report.prior.start, '2026-08-28');
    assert.equal(report.prior.end, '2026-09-04');
    assert.equal(report.recent.lists, 3);
    assert.equal(report.prior.lists, 2);
    assert.equal(report.days, 7);
  });

  it('ignores lists on or after the window end', () => {
    const late = list(0, 'A');
    late.tournamentDate = END;
    const report = buildWeeklyReport([late, list(-1, 'A'), list(1, 'A')], LOOSE);
    assert.equal(report.recent.lists, 1);
  });

  it('spans fourteen dated days ending the day before the window end', () => {
    const report = buildWeeklyReport([list(1, 'A')], LOOSE);
    assert.equal(report.dates.length, 14);
    assert.equal(report.dates[0], '2026-08-28');
    assert.equal(report.dates[13], '2026-09-10');
  });

  it('counts top-10% finishes per period', () => {
    const report = buildWeeklyReport([list(1, 'A', [], true), list(2, 'A'), list(8, 'A', [], true)], LOOSE);
    assert.equal(report.recent.top10, 1);
    assert.equal(report.prior.top10, 1);
  });
});

describe('buildWeeklyReport archetypes', () => {
  it('reports share, change, and top-10% share for each period', () => {
    const decks = [
      ...lists(6, 1, 'A', [], true),
      ...lists(4, 1, 'B'),
      ...lists(4, 8, 'A'),
      ...lists(6, 8, 'B', [], true)
    ];
    const report = buildWeeklyReport(decks, LOOSE);
    const a = report.archetypes.find(row => row.displayName === 'A');
    assert.ok(a);
    assert.equal(a.share, 60);
    assert.equal(a.priorShare, 40);
    assert.equal(a.delta, 20);
    assert.equal(a.top10Share, 100);
    assert.equal(a.priorTop10Share, 0);
    assert.equal(a.lists, 6);
    assert.equal(a.priorLists, 4);
  });

  it('keeps the Other bucket in the denominator but out of the rows', () => {
    const report = buildWeeklyReport([...lists(1, 1, 'A'), ...lists(3, 1, 'Other')], LOOSE);
    assert.deepEqual(
      report.archetypes.map(row => row.displayName),
      ['A']
    );
    assert.equal(report.archetypes[0].share, 25);
    assert.equal(report.recent.lists, 4);
  });

  it("sorts by this week's share and honours the limit", () => {
    const decks = [...lists(1, 1, 'A'), ...lists(3, 1, 'B'), ...lists(2, 1, 'C')];
    const report = buildWeeklyReport(decks, { ...LOOSE, archetypeLimit: 2 });
    assert.deepEqual(
      report.archetypes.map(row => row.displayName),
      ['B', 'C']
    );
  });

  it('plots a daily share and nulls days under the floor', () => {
    const decks = [...lists(2, 1, 'A'), ...lists(2, 1, 'B'), list(2, 'A')];
    const report = buildWeeklyReport(decks, { ...LOOSE, minDayLists: 2 });
    const a = report.archetypes.find(row => row.displayName === 'A')!;
    const sep10 = a.daily.find(p => p.date === '2026-09-10')!;
    const sep9 = a.daily.find(p => p.date === '2026-09-09')!;
    assert.equal(sep10.share, 50);
    assert.equal(sep10.lists, 2);
    assert.equal(sep9.share, null, 'one list is under the two-list floor');
    assert.equal(sep9.lists, 1);
  });
});

describe('buildWeeklyReport decks', () => {
  const judge = card('Judge', 'POR', '076');
  const eri = card('Eri', 'TEF', '146');

  it('lists the cards a deck added and cut, as inclusion among its own lists', () => {
    const decks = [
      ...lists(8, 1, 'A', [judge]),
      ...lists(2, 1, 'A', [eri]),
      ...lists(2, 8, 'A', [judge]),
      ...lists(8, 8, 'A', [eri])
    ];
    const report = buildWeeklyReport(decks, LOOSE);
    const a = report.decks.find(d => d.displayName === 'A');
    assert.ok(a);
    assert.equal(a.lists, 10);
    assert.deepEqual(
      a.added.map(c => [c.name, c.priorInclusion, c.inclusion, c.delta]),
      [['Judge', 20, 80, 60]]
    );
    assert.deepEqual(
      a.cut.map(c => [c.name, c.priorInclusion, c.inclusion, c.delta]),
      [['Eri', 80, 20, -60]]
    );
    assert.equal(a.added[0].set, 'POR');
    assert.equal(a.added[0].number, '076');
  });

  it('flags a card as new when it crosses five percent', () => {
    const decks = [...lists(1, 1, 'A', [judge]), ...lists(9, 1, 'A'), ...lists(50, 8, 'A'), list(8, 'A', [judge])];
    const report = buildWeeklyReport(decks, LOOSE);
    const added = report.decks[0].added[0];
    assert.equal(added.name, 'Judge');
    assert.equal(added.isNew, true);
  });

  it('needs the floor of lists in both periods before a deck block appears', () => {
    const decks = [
      ...lists(30, 1, 'A', [judge]),
      ...lists(5, 8, 'A'),
      ...lists(30, 1, 'B'),
      ...lists(30, 8, 'B', [eri])
    ];
    const report = buildWeeklyReport(decks, { ...LOOSE, minDeckLists: 20 });
    assert.deepEqual(
      report.decks.map(d => d.displayName),
      ['B']
    );
  });

  it('gives each deck card a daily inclusion series with a per-day floor', () => {
    const decks = [...lists(4, 1, 'A', [judge]), ...lists(4, 1, 'A'), list(2, 'A', [judge]), ...lists(2, 8, 'A')];
    const report = buildWeeklyReport(decks, { ...LOOSE, minDeckDayLists: 2 });
    const j = report.decks[0].added.find(c => c.name === 'Judge')!;
    assert.equal(j.daily.length, 14);
    assert.equal(j.daily[13], 50, 'Sep 10: 4 of 8 lists');
    assert.equal(j.daily[12], null, 'Sep 9 had one list, under the floor');
  });

  it('leaves basic energy out of the deck changes', () => {
    const fire = card('Fire Energy', 'SVE', '002');
    const decks = [...lists(5, 1, 'A', [fire, judge]), ...lists(5, 8, 'A')];
    const report = buildWeeklyReport(decks, LOOSE);
    assert.deepEqual(
      report.decks[0].added.map(c => c.name),
      ['Judge']
    );
  });
});

describe('buildWeeklyReport movers', () => {
  const judge = card('Judge', 'POR', '076');

  it("attributes a card's change to the archetypes that drove it, and the parts sum", () => {
    // A doubles its share and always plays Judge (mix); B is flat and adopts
    // Judge in half its lists (adoption).
    const decks = [
      ...lists(20, 1, 'A', [judge]),
      ...lists(20, 1, 'B', [judge]),
      ...lists(20, 1, 'B'),
      ...lists(10, 8, 'A', [judge]),
      ...lists(40, 8, 'B')
    ];
    const report = buildWeeklyReport(decks, LOOSE);
    const j = report.movers.rising.find(m => m.name === 'Judge');
    assert.ok(j);
    assert.equal(j.priorShare, 20);
    assert.equal(j.share, 66.7);
    assert.equal(j.delta, 46.7);
    assert.equal(Math.round((j.mix + j.adoption) * 10) / 10, j.delta);
    const a = j.drivers.find(d => d.displayName === 'A')!;
    const b = j.drivers.find(d => d.displayName === 'B')!;
    // A: share 20% → 33.3%, Judge in every list: all mix, no adoption.
    assert.equal(a.mix, 13.3);
    assert.equal(a.adoption, 0);
    // B: share 80% → 66.7% (a small negative mix) while adopting Judge in half its lists.
    assert.equal(b.mix, -3.3);
    assert.equal(b.adoption, 36.7);
    assert.equal(j.drivers[0].displayName, 'B', 'drivers rank by absolute contribution');
  });

  it('collapses an evolution line that moves together into its final stage', () => {
    const line = [card('Abra', 'SET', '010'), card('Kadabra', 'SET', '011'), card('Alakazam', 'SET', '012')];
    const decks = [...lists(10, 1, 'A', line), ...lists(2, 8, 'A', line), ...lists(10, 8, 'B')];
    const report = buildWeeklyReport(decks, LOOSE);
    assert.deepEqual(
      report.movers.rising.map(m => m.name),
      ['Alakazam']
    );
  });

  it('keeps cards from different sets apart even when their presence matches', () => {
    const pair = [card('Switch', 'MEG', '130'), card('Nest Ball', 'SVI', '181')];
    const decks = [...lists(10, 1, 'A', pair), ...lists(2, 8, 'A', pair), ...lists(10, 8, 'B')];
    const report = buildWeeklyReport(decks, LOOSE);
    assert.deepEqual(report.movers.rising.map(m => m.name).sort(), ['Nest Ball', 'Switch']);
  });

  it('needs enough list appearances before a card can move', () => {
    const decks = [...lists(3, 1, 'A', [judge]), ...lists(30, 8, 'A')];
    const thin = buildWeeklyReport(decks, { ...LOOSE, minMoverLists: 10 });
    assert.deepEqual(thin.movers.rising, []);
    const loose = buildWeeklyReport(decks, { ...LOOSE, minMoverLists: 3 });
    assert.equal(loose.movers.rising[0].name, 'Judge');
  });

  it('canonicalizes reprints through the synonym database', () => {
    const synonymDb = {
      synonyms: { 'Judge::SVI::176': 'Judge::POR::076' },
      canonicals: { 'Judge::POR::076': ['Judge::SVI::176'] }
    };
    const decks = [
      ...lists(5, 1, 'A', [card('Judge', 'SVI', '176')]),
      ...lists(5, 1, 'A', [judge]),
      ...lists(10, 8, 'A')
    ];
    const report = buildWeeklyReport(decks, { ...LOOSE, synonymDb: synonymDb as never });
    assert.equal(report.movers.rising.length, 1);
    assert.equal(report.movers.rising[0].share, 100);
    assert.equal(report.movers.rising[0].set, 'POR');
  });
});

describe('buildWeeklyReport edge cases', () => {
  it('returns empty lists for no decks', () => {
    const report = buildWeeklyReport([], LOOSE);
    assert.deepEqual(report.archetypes, []);
    assert.deepEqual(report.decks, []);
    assert.deepEqual(report.movers, { rising: [], falling: [] });
    assert.equal(report.recent.lists, 0);
  });

  it('rejects an unparseable window end', () => {
    assert.throws(() => buildWeeklyReport([], { windowEnd: 'never' }), /windowEnd/);
  });

  it('skips decks without a parseable date', () => {
    const undated = { archetype: 'A', cards: [] } as TrendDeckInput;
    const report = buildWeeklyReport([undated, list(1, 'A')], LOOSE);
    assert.equal(report.recent.lists, 1);
  });
});

describe('appendTrendHistory', () => {
  it("appends the newest complete day with every archetype's counts", () => {
    const decks = [...lists(3, 1, 'A', [], true), ...lists(1, 1, 'B'), ...lists(5, 2, 'A')];
    const report = buildWeeklyReport(decks, LOOSE);
    const history = appendTrendHistory(null, report);
    assert.equal(history.schemaVersion, 1);
    assert.equal(history.days.length, 1);
    assert.deepEqual(history.days[0], {
      date: '2026-09-10',
      lists: 4,
      top10: 3,
      archetypes: { a: { displayName: 'A', lists: 3, top10: 3 }, b: { displayName: 'B', lists: 1, top10: 0 } }
    });
  });

  it('replaces a day already present and keeps rows sorted', () => {
    const report = buildWeeklyReport(lists(2, 1, 'A'), LOOSE);
    const stale = { date: '2026-09-10', lists: 99, top10: 0, archetypes: {} };
    const older = { date: '2026-09-01', lists: 5, top10: 1, archetypes: {} };
    const history = appendTrendHistory({ schemaVersion: 1, generatedAt: '', days: [stale, older] }, report);
    assert.deepEqual(
      history.days.map(d => [d.date, d.lists]),
      [
        ['2026-09-01', 5],
        ['2026-09-10', 2]
      ]
    );
  });

  it('adds nothing when the newest day has no lists', () => {
    const report = buildWeeklyReport(lists(2, 3, 'A'), LOOSE);
    const history = appendTrendHistory(null, report);
    assert.deepEqual(history.days, []);
  });

  it('reports daily totals across every archetype', () => {
    const report = buildWeeklyReport([...lists(2, 1, 'A'), ...lists(3, 1, 'Other', [], true)], LOOSE);
    assert.deepEqual(report.dailyTotals[13], { date: '2026-09-10', lists: 5, top10: 3 });
  });
});
