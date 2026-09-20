import { execFileSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { boolEnv } from './lib/env';
import { completedStage, pipelineStore } from './lib/pipelineStore';
import { builderRevision } from './lib/build/revision';
import { runMajorData } from './run-major-data';
import { refreshCardAssets } from './lib/cardAssets';

function node(script: string, args: string[] = []): void {
  execFileSync(process.execPath, ['--import', 'tsx', `.github/scripts/${script}`, ...args], { stdio: 'inherit' });
}
function python(script: string, args: string[] = []): void {
  execFileSync('python3', [`.github/scripts/${script}`, ...args], { stdio: 'inherit' });
}

async function daily(): Promise<void> {
  const store = pipelineStore();
  const revision = await builderRevision([
    '.github/scripts/run-online-meta.ts',
    '.github/scripts/lib/onlineMeta.ts',
    '.github/scripts/run-trends.ts',
    '.github/scripts/update-prices.py',
    '.github/scripts/run-pack-ev.ts',
    'shared/onlineMeta/tournamentFetcher.ts'
  ]);
  await completedStage(store, 'daily', {
    inputs: new Date().toISOString().slice(0, 10),
    revision,
    force: boolEnv('FORCE_REFRESH'),
    run: async () => {
      // Cache lifetime is one acquisition cycle, never a stale cross-day API cache.
      process.env.ONLINE_FETCH_CACHE = '.cache/online-api';
      await rm(process.env.ONLINE_FETCH_CACHE, { recursive: true, force: true });
      node('run-online-meta.ts');
      node('run-trends.ts');
      python('update-prices.py');
      node('run-pack-ev.ts');
    }
  });
}

function tournaments(): void {
  if (!process.env.LIMITLESS_INPUT) {
    python('ingest-new-tournaments.py');
    return;
  }
  if (boolEnv('DRY_RUN')) {
    console.log(`Preview: would ingest ${process.env.LIMITLESS_INPUT}`);
    return;
  }
  python('download-tournament.py');
}

async function maintenance(): Promise<void> {
  const operation = process.env.OPERATION ?? 'prune';
  const apply = boolEnv('APPLY');
  if (operation === 'prune') {
    node('prune-releases.ts', apply ? ['--write'] : []);
    return;
  }
  if (operation === 'inventory') {
    node('inventory-bucket.ts');
    return;
  }
  if (operation === 'reconcile-events') {
    process.env.RECONCILE_EVENTS = 'true';
    process.env.DRY_RUN = apply ? 'false' : 'true';
    python('ingest-new-tournaments.py');
    if (apply) {
      await runMajorData();
    }
    return;
  }
  if (!apply) {
    console.log(`Preview: ${operation}; no data will be changed`);
    return;
  }
  if (operation === 'bootstrap') {
    node('bootstrap-deployment.ts');
    return;
  }
  const store = pipelineStore();
  await completedStage(store, 'daily', {
    inputs: { operation, days: process.env.DAYS, dates: process.env.DATES },
    revision: 'repair-v1',
    force: true,
    run: async () => {
      if (operation === 'price-history') {
        python('backfill-price-history.py', ['--days', process.env.DAYS ?? '90']);
        return;
      }
      if (operation === 'print-prices') {
        python('backfill-print-prices.py', process.env.DATES ? ['--dates', process.env.DATES] : []);
        return;
      }
      throw new Error(`Unknown maintenance operation: ${operation}`);
    }
  });
}

async function main(): Promise<void> {
  const operation = process.argv[2];
  if (operation === 'daily') {
    await daily();
    return;
  }
  if (operation === 'assets') {
    await refreshCardAssets();
    return;
  }
  if (operation === 'tournaments') {
    tournaments();
    return;
  }
  if (operation === 'maintenance') {
    await maintenance();
    return;
  }
  throw new Error(`Unknown data pipeline: ${operation}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
