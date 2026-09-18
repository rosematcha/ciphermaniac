import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { completedStage, pipelineStore } from './pipelineStore';
import { builderRevision } from './build/revision';
import { loadEventSources } from './build/productionRelease';
import { boolEnv } from './env';
import { inputFingerprint } from './build/provenance';
import { newSetCodes } from './setSeeds';

type Store = ReturnType<typeof pipelineStore>;

function run(script: string, args: string[] = []): void {
  const python = script.endsWith('.py');
  execFileSync(
    python ? 'python3' : process.execPath,
    python ? [script, ...args] : ['--import', 'tsx', script, ...args],
    { stdio: 'inherit' }
  );
}

function content(value: unknown): unknown {
  if (!value || typeof value !== 'object') {
    return value;
  }
  const { metadata: _metadata, ...fields } = value as Record<string, unknown>;
  return fields;
}

async function writeLocal(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value));
}

async function cardTypes(store: Store): Promise<void> {
  const { sources } = await loadEventSources(store);
  const cards = new Set<string>();
  for (const key of [
    ...Object.values(sources).map(root => `${root.slice(1)}/master.json`),
    'reports/Online - Last 14 Days/master.json'
  ]) {
    const report = await store.read<{ items?: Array<{ set?: string; number?: string | number }> }>(key);
    if (!report) {
      throw new Error(`Missing card discovery source: ${key}`);
    }
    for (const item of report.items ?? []) {
      if (item.set && item.number) {
        cards.add(`${item.set}::${item.number}`);
      }
    }
  }
  const revision = await builderRevision(['scripts/build-card-types.mjs']);
  await completedStage(store, 'card-types', {
    inputs: [...cards].sort(),
    revision,
    force: boolEnv('FORCE_REFRESH'),
    run: async () => {
      await writeLocal('.cache/card-types-input.json', [...cards].sort());
      await writeLocal('public/assets/data/card-types.json', (await store.read('assets/data/card-types.json')) ?? {});
      process.env.CARD_TYPES_INPUT = '.cache/card-types-input.json';
      run('scripts/build-card-types.mjs');
      for (const file of ['card-types', 'card-facets', 'evolves-from']) {
        const body = JSON.parse(await readFile(`public/assets/data/${file}.json`, 'utf8')) as unknown;
        const previous = await store.read(`assets/data/${file}.json`);
        if (inputFingerprint(body) !== inputFingerprint(previous)) {
          await store.write(`assets/data/${file}.json`, body);
        }
      }
    }
  });
}

async function synonyms(store: Store): Promise<void> {
  const { sources } = await loadEventSources(store);
  const online = await store.read<Array<{ cards?: Array<{ name?: string; set?: string; number?: string | number }> }>>(
    'reports/Online - Last 14 Days/decks.json'
  );
  const onlineCards = [
    ...new Set(
      (online ?? []).flatMap(deck =>
        (deck.cards ?? []).map(card => `${card.name ?? ''}\0${card.set ?? ''}\0${card.number ?? ''}`)
      )
    )
  ].sort();
  await completedStage(store, 'synonyms', {
    inputs: { sources, onlineCards, newSets: newSetCodes(new Date().toISOString().slice(0, 10)) },
    revision: await builderRevision([
      '.github/scripts/update-card-synonyms.mjs',
      '.github/scripts/lib/setSeeds.ts',
      '.github/scripts/data/set-catalog.json'
    ]),
    force: boolEnv('FORCE_REFRESH'),
    run: async () => {
      run('.github/scripts/update-card-synonyms.mjs');
    }
  });
}

async function images(store: Store): Promise<void> {
  const inputs = content(await store.read('assets/card-synonyms.json'));
  await completedStage(store, 'card-images', {
    inputs,
    revision: await builderRevision(['scripts/convert-card-images.ts', '.github/scripts/build-art-groups.py']),
    force: boolEnv('FORCE_REFRESH'),
    run: async () => {
      run('scripts/convert-card-images.ts');
      run('.github/scripts/build-art-groups.py', ['--output', 'card-art-groups.json']);
    }
  });
}

async function archetypes(store: Store): Promise<void> {
  const date = new Date().toISOString();
  const force = boolEnv('FORCE_REFRESH');
  await completedStage(store, 'archetype-icons', {
    inputs: date.slice(0, 10),
    force,
    revision: await builderRevision([
      '.github/scripts/scrape-archetype-icons.py',
      'scripts/mirror-archetype-sprites.ts'
    ]),
    run: async () => {
      run('.github/scripts/scrape-archetype-icons.py', ['--publish']);
      run('scripts/mirror-archetype-sprites.ts');
    }
  });
  const requested = process.env.REQUESTED_FORMATS?.trim();
  await completedStage(store, 'format-archetypes', {
    inputs: { month: date.slice(0, 7), requested: requested ?? '' },
    force,
    revision: await builderRevision(['.github/scripts/scrape-format-archetypes.py']),
    run: async () => {
      const formats = requested ? requested.split(/\s+/) : ['expanded'];
      const args = formats.includes('all') ? ['--all'] : formats.flatMap(format => ['--format', format]);
      run('.github/scripts/scrape-format-archetypes.py', ['--publish', ...args]);
      run('scripts/mirror-archetype-sprites.ts');
    }
  });
}

export async function refreshCardAssets(): Promise<void> {
  const store = pipelineStore();
  await completedStage(store, 'assets', {
    inputs: { date: new Date().toISOString().slice(0, 10), formats: process.env.REQUESTED_FORMATS ?? '' },
    revision: await builderRevision(['.github/scripts/lib/cardAssets.ts']),
    force: true,
    run: async () => {
      await synonyms(store);
      await cardTypes(store);
      await archetypes(store);
      await images(store);
    }
  });
}
