import test from 'node:test';
import assert from 'node:assert/strict';
import { generateReportForFilters } from '../../src/utils/clientSideFiltering.ts';

test('filtered card shows 100% usage when filter requires it', () => {
  const decks = [
    {
      id: 'd1',
      archetype: 'TestArch',
      cards: [
        { set: 'SV01', number: '001', name: 'Gholdengo', count: 4 },
        { set: 'SV01', number: '002', name: 'Lunatone', count: 2 }
      ],
      placement: 1,
      tournamentPlayers: 32
    },
    {
      id: 'd2',
      archetype: 'TestArch',
      cards: [
        { set: 'SV01', number: '001', name: 'Gholdengo', count: 4 },
        { set: 'SV01', number: '002', name: 'Lunatone', count: 3 }
      ],
      placement: 2,
      tournamentPlayers: 32
    },
    {
      id: 'd3',
      archetype: 'TestArch',
      cards: [{ set: 'SV01', number: '001', name: 'Gholdengo', count: 4 }],
      placement: 3,
      tournamentPlayers: 32
    }
  ];

  const noFilterReport = generateReportForFilters(decks as any, 'TestArch', []);
  const lunatone = noFilterReport.items.find((item: any) => item.name === 'Lunatone');
  assert.ok(lunatone, 'Lunatone should exist in unfiltered report');
  assert.equal(lunatone.found, 2, 'Lunatone found in 2/3 decks');
  assert.equal(lunatone.total, 3, 'Total decks is 3');
  const unfilteredPct = (lunatone.found / lunatone.total) * 100;
  assert.ok(
    Math.abs(unfilteredPct - 66.67) < 1,
    `Unfiltered Lunatone usage should be ~66.7%, got ${unfilteredPct.toFixed(1)}%`
  );

  const filterForLunatone = [{ cardId: 'SV01~002', operator: '>=', count: 1 }];
  const filteredReport = generateReportForFilters(decks as any, 'TestArch', filterForLunatone as any);
  assert.equal(filteredReport.deckTotal, 2, 'Only 2 decks should match the filter');

  const filteredLunatone = filteredReport.items.find((item: any) => item.name === 'Lunatone');
  assert.ok(filteredLunatone, 'Lunatone should exist in filtered report');
  assert.equal(filteredLunatone.found, 2, 'Lunatone found in 2/2 filtered decks');
  assert.equal(filteredLunatone.total, 2, 'Total decks is 2 after filtering');
  assert.equal(filteredLunatone.pct, 100, 'Lunatone should have 100% usage in filtered results');
});

test('histogram distribution recalculates based on filtered pool', () => {
  const decks = [
    {
      id: 'd1',
      archetype: 'TestArch',
      cards: [{ set: 'SV01', number: '001', name: 'TestCard', count: 2 }],
      placement: 1,
      tournamentPlayers: 32
    },
    {
      id: 'd2',
      archetype: 'TestArch',
      cards: [{ set: 'SV01', number: '001', name: 'TestCard', count: 4 }],
      placement: 2,
      tournamentPlayers: 32
    },
    {
      id: 'd3',
      archetype: 'TestArch',
      cards: [{ set: 'SV01', number: '001', name: 'TestCard', count: 4 }],
      placement: 3,
      tournamentPlayers: 32
    },
    {
      id: 'd4',
      archetype: 'TestArch',
      cards: [{ set: 'SV01', number: '001', name: 'TestCard', count: 4 }],
      placement: 4,
      tournamentPlayers: 32
    }
  ];

  const unfiltered = generateReportForFilters(decks as any, 'TestArch', []);
  const testCardUnfiltered = unfiltered.items.find((item: any) => item.name === 'TestCard');
  assert.ok(testCardUnfiltered, 'TestCard should exist');
  assert.ok(testCardUnfiltered.dist, 'TestCard should have distribution');

  const dist2Unfiltered = testCardUnfiltered.dist.find((d: any) => d.copies === 2);
  const dist4Unfiltered = testCardUnfiltered.dist.find((d: any) => d.copies === 4);
  assert.ok(dist2Unfiltered, '2-copy distribution should exist');
  assert.ok(dist4Unfiltered, '4-copy distribution should exist');
  assert.equal(dist2Unfiltered.players, 1, '1 deck has 2 copies');
  assert.equal(dist4Unfiltered.players, 3, '3 decks have 4 copies');

  const filterFor4Copies = [{ cardId: 'SV01~001', operator: '=', count: 4 }];
  const filtered = generateReportForFilters(decks as any, 'TestArch', filterFor4Copies as any);
  assert.equal(filtered.deckTotal, 3, 'Only 3 decks have exactly 4 copies');

  const testCardFiltered = filtered.items.find((item: any) => item.name === 'TestCard');
  assert.ok(testCardFiltered, 'TestCard should exist in filtered report');
  assert.ok(testCardFiltered.dist, 'Filtered TestCard should have distribution');

  const dist4Filtered = testCardFiltered.dist.find((d: any) => d.copies === 4);
  assert.ok(dist4Filtered, '4-copy distribution should exist in filtered results');
  assert.equal(dist4Filtered.players, 3, '3 decks in filtered pool have 4 copies');
  assert.equal(dist4Filtered.percent, 100, '100% of filtered decks have 4 copies');

  const dist2Filtered = testCardFiltered.dist.find((d: any) => d.copies === 2);
  assert.ok(!dist2Filtered || dist2Filtered.players === 0, '2-copy should not exist or have 0 players');
});
