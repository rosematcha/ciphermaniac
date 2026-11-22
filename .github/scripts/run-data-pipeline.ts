import { execFileSync, spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { boolEnv } from './lib/env';
import { completedStage, pipelineStore, type StageStore } from './lib/pipelineStore';
import { builderRevision } from './lib/build/revision';
import { runMajorData } from './run-major-data';
import { refreshCardAssets } from './lib/cardAssets';
import { ONLINE_PREFIX } from './lib/build/capturedScope';

/** The online master release capture publishes; price movers judge Standard eligibility by it. */
const STAGED_ONLINE_MASTER = `${ONLINE_PREFIX}master.json`;

function node(script: string, args: string[] = []): void {
  execFileSync(process.execPath, ['--import', 'tsx', `.github/scripts/${script}`, ...args], { stdio: 'inherit' });
}
function python(script: string, args: string[] = []): void {
  execFileSync('python3', ['-u', `.github/scripts/${script}`, ...args], { stdio: 'inherit' });
}

/** Run a child to completion without blocking the others; rejects on a non-zero exit. */
function spawned(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) =>
      code === 0 ? resolve() : reject(new Error(`${args.join(' ')} exited with ${signal ?? code}`))
    );
  });
}

/** Wait for every child, then fail with the first failure, so no child is left running unwatched. */
export async function runSideBySide(runs: Array<() => Promise<void>>): Promise<void> {
  const results = await Promise.allSettled(runs.map(run => run()));
  const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failed) {
    throw failed.reason;
  }
}

async function daily(): Promise<void> {
  const store = pipelineStore();
  const revision = await builderRevision([
    '.github/scripts/run-online-meta.ts',
    '.github/scripts/lib/onlineMeta.ts',
    '.github/scripts/run-trends.ts',
    '.github/scripts/publish-deck-rules.ts',
    '.github/scripts/lib/limitlessDeckRules.ts',
    '.github/scripts/update-prices.py',
    '.github/scripts/run-pack-ev.ts',
    '.github/scripts/run-format-meta.ts',
    '.github/scripts/lib/formatMeta.ts',
    '.github/scripts/lib/cityLeagues/index.ts',
    '.github/scripts/lib/cityLeagues/archetypes.ts',
    'config/archetypes/city-leagues.json',
    'shared/formats/deckRules.ts',
    'shared/formats/registry.ts',
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
      // After online meta, whose fetch of the same rules the run's cache already holds.
      node('publish-deck-rules.ts');
      node('run-trends.ts');
      // Two lanes on separate hosts and key prefixes: TCGCSV (prices, then pack EV, one request at a
      // time) beside Limitless (format meta). Prices still price format prints from the served release.
      await runSideBySide([
        async () => {
          await spawned('python3', ['-u', '.github/scripts/update-prices.py', '--online-master', STAGED_ONLINE_MASTER]);
          await spawned(process.execPath, ['--import', 'tsx', '.github/scripts/run-pack-ev.ts']);
        },
        () => spawned(process.execPath, ['--import', 'tsx', '.github/scripts/run-format-meta.ts'])
      ]);
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
  await runRepair(pipelineStore(), operation);
}

const repairs: Record<string, (marker: string) => void> = {
  'price-history': marker =>
    python('backfill-price-history.py', [
      '--days',
      process.env.DAYS ?? '90',
      '--online-master',
      STAGED_ONLINE_MASTER,
      '--marker',
      marker
    ]),
  'print-prices': marker =>
    python('backfill-print-prices.py', [
      ...(process.env.DATES ? ['--dates', process.env.DATES] : []),
      '--marker',
      marker
    ])
};

/**
 * Each repair keeps its own marker, so it never clears a failed daily run or another repair. The
 * repair script marks it unfinished just before its first write, so one that fails earlier blocks
 * nothing.
 */
export async function runRepair(store: StageStore, operation: string, run = repairs[operation]): Promise<void> {
  if (!run) {
    throw new Error(`Unknown maintenance operation: ${operation}`);
  }
  const marker = `build/v1/producers/repair-${operation}.json`;
  run(marker);
  await store.write(marker, {
    inputs: { operation, days: process.env.DAYS, dates: process.env.DATES },
    status: 'complete'
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
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
