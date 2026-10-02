import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSearchIndex, searchTiered } from '../src/lib/globalSearch';
import { findCardInArchetypeReport } from '../src/pages/cardPage/model';
import type { ArchetypeReport, CardItem } from '../src/types';
import type { PlayerIndexSlimEntry } from '../shared/playerTypes';

const playerCount = Number(process.argv[2] ?? 10000);
assert.ok(Number.isInteger(playerCount) && playerCount > 0, 'Player count must be a positive integer');
const report = JSON.parse(
  readFileSync(new URL('../tests/fixtures/e2e/reports/Online - Last 14 Days/master.json', import.meta.url), 'utf8')
) as ArchetypeReport;
const players: PlayerIndexSlimEntry[] = Array.from({ length: playerCount }, (_, i) => ({
  playerId: String(i),
  name: `Player ${i % 100} Garcia ${i}`,
  eventCount: i % 30,
  wins: 0,
  losses: 0,
  day2s: 0,
  topCuts: 0,
  tournamentWins: 0
}));
const index = buildSearchIndex({ cards: report.items, players });
const queries = ['a', 'player', 'garcia', 'player 42', 'pokegear', 'MEG 114', 'no-such-player'];

function measure(run: () => number): { medianMs: number; p95Ms: number; checksum: number } {
  const batchSize = 50;
  const samples: number[] = [];
  let checksum = 0;
  for (let i = 0; i < 20; i++) {
    checksum += run();
  }
  for (let sample = 0; sample < 25; sample++) {
    const start = performance.now();
    for (let i = 0; i < batchSize; i++) {
      checksum += run();
    }
    samples.push((performance.now() - start) / batchSize);
  }
  samples.sort((a, b) => a - b);
  return { medianMs: samples[12], p95Ms: samples[23], checksum };
}

console.log(
  `Search response CPU time: ${index.length} entries (${report.items.length} fixture cards, ${playerCount} synthetic players)`
);
console.log('20 warmups; 25 batches of 50 queries; p95 is the batch-average percentile; excludes loading/rendering.');
for (const query of queries) {
  const timing = measure(() => searchTiered(index, query).hits.length);
  console.log(JSON.stringify({ query, ...timing }));
}
const missing = { name: 'Missing', set: 'ZZZ', number: '999' } as CardItem;
const nameOnly = { ...missing, name: report.items[0].name };
for (const card of [missing, nameOnly]) {
  const timing = measure(() => Number(findCardInArchetypeReport(report, card) !== null));
  console.log(JSON.stringify({ lookup: card.name, ...timing }));
}
