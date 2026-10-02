import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';
import { aggregateOnlineWinRate } from '../shared/data/archetypes/winRate';
import { aggregateEventWinRate } from '../src/lib/archetypeWinRate';
import { rowsFromOnlineMatchups } from '../src/lib/matchups';
import type { ArchetypeIndexEntry } from '../src/types';
import type { OnlineMatchupRecord } from '../src/lib/data/matchups';

// Optional report directory: npm run bench:archetype-winrates -- /path/to/report
// Without it, measure the current live online report. Fetches are outside timings.
const directory = process.argv[2];
const root = 'https://r2.ciphermaniac.com/reports/Online%20-%20Last%2014%20Days';
async function load(path: string): Promise<string> {
  if (directory) {
    return readFile(join(directory, path), 'utf8');
  }
  const response = await fetch(`${root}/${path}`, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    throw new Error(`${path}: HTTP ${response.status}`);
  }
  return response.text();
}

interface Trends {
  matchups?: Record<string, OnlineMatchupRecord>;
}
const indexBody = await load('archetypes/index.json');
const index = JSON.parse(indexBody) as ArchetypeIndexEntry[];
const trendBodies = await Promise.all(
  index.map(entry => load(`archetypes/${encodeURIComponent(entry.name)}/trends.json`))
);
const consolidated = index.map((entry, i) => {
  const trends = JSON.parse(trendBodies[i]) as Trends;
  const aggregate = aggregateOnlineWinRate(trends.matchups ?? {}, entry.label);
  assert.deepEqual(aggregate, aggregateEventWinRate(rowsFromOnlineMatchups(trends.matchups ?? {}, entry.label)));
  return { ...entry, winRateAggregate: aggregate };
});
const consolidatedBody = JSON.stringify(consolidated);
const legacyBody = JSON.stringify(index.map(({ winRateAggregate: _aggregate, ...entry }) => entry));

function sizes(body: string) {
  return {
    raw: Buffer.byteLength(body),
    br: brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).byteLength
  };
}
const oldIndex = sizes(legacyBody);
const newIndex = sizes(consolidatedBody);
const trendsBytes = trendBodies
  .map(sizes)
  .reduce((sum, size) => ({ raw: sum.raw + size.raw, br: sum.br + size.br }), { raw: 0, br: 0 });

function measure(run: () => number) {
  let checksum = 0;
  for (let i = 0; i < 20; i++) {
    checksum += run();
  }
  const samples = Array.from({ length: 50 }, () => {
    const start = performance.now();
    checksum += run();
    return performance.now() - start;
  }).sort((a, b) => a - b);
  return { medianMs: samples[25], p95Ms: samples[47], checksum };
}

console.log(`Archetype index: ${index.length} entries; source: ${directory ?? root}`);
console.log(
  'Before includes the missing profile probe (404 body excluded). Brotli quality 11; CPU includes JSON parsing and aggregation, excludes network/rendering. 20 warmups, 50 samples.'
);
console.log(
  JSON.stringify({
    before: {
      requests: 2 + index.length,
      rawBytes: oldIndex.raw + trendsBytes.raw,
      brBytes: oldIndex.br + trendsBytes.br
    },
    after: { requests: 1, rawBytes: newIndex.raw, brBytes: newIndex.br },
    aggregateIndexOverhead: { rawBytes: newIndex.raw - oldIndex.raw, brBytes: newIndex.br - oldIndex.br }
  })
);
console.log(
  JSON.stringify({
    beforeCPU: measure(() => {
      const entries = JSON.parse(legacyBody) as ArchetypeIndexEntry[];
      return entries.reduce((games, entry, i) => {
        const trends = JSON.parse(trendBodies[i]) as Trends;
        return games + aggregateEventWinRate(rowsFromOnlineMatchups(trends.matchups ?? {}, entry.label)).games;
      }, 0);
    }),
    afterCPU: measure(() => {
      const entries = JSON.parse(consolidatedBody) as ArchetypeIndexEntry[];
      return entries.reduce((games, entry) => games + (entry.winRateAggregate?.games ?? 0), 0);
    })
  })
);
