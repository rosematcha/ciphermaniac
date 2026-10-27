import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { completedStage, pipelineStore } from './pipelineStore';
import { builderRevision } from './build/revision';
import { loadEventSources, productionScopeRoot } from './build/productionRelease';
import { boolEnv } from './env';
import { inputFingerprint } from './build/provenance';
import { loadFormatDecks, loadOnlineDecks } from './build/onlineDecks';
import { formatRoots, releaseFormatsRoot } from './build/formatReports';
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

type Reader = Pick<Store, 'read'>;

/** Every `set::number` the card-types builder must cover, sorted. */
export async function discoverCardTypeCards(store: Reader): Promise<string[]> {
  const { sources } = await loadEventSources(store);
  const cards = new Set<string>();
  for (const key of [
    ...Object.values(sources).map(root => `${root.slice(1)}/master.json`),
    'reports/Online - Last 14 Days/master.json',
    ...(await formatRoots(store)).map(root => `${root}/master.json`)
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
  return [...cards].sort();
}

async function cardTypes(store: Store): Promise<void> {
  const cards = await discoverCardTypeCards(store);
  const revision = await builderRevision(['scripts/build-card-types.mjs']);
  await completedStage(store, 'card-types', {
    inputs: cards,
    revision,
    force: boolEnv('FORCE_REFRESH'),
    run: async () => {
      await writeLocal('.cache/card-types-input.json', cards);
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

type DeckCards = { cards?: Array<{ name?: string; set?: string; number?: string | number }> };

function deckCardKeys(decks: DeckCards[]): string[] {
  return [
    ...new Set(
      decks.flatMap(deck =>
        (deck.cards ?? []).map(card => `${card.name ?? ''}\0${card.set ?? ''}\0${card.number ?? ''}`)
      )
    )
  ].sort();
}

/**
 * Optional stage inputs. A key is present only when it has content, so a run
 * with no formats fingerprints exactly as it did before formats existed.
 */
function whenPresent(key: string, value: unknown): Record<string, unknown> {
  const empty = value === null || (Array.isArray(value) && value.length === 0);
  return empty ? {} : { [key]: value };
}

/** What the synonyms stage depends on: every source whose decks it scrapes. */
export async function synonymInputs(store: Reader, today: string): Promise<Record<string, unknown>> {
  const { sources } = await loadEventSources(store);
  const onlineCards = deckCardKeys(await loadOnlineDecks<DeckCards>(store));
  const formatCards = deckCardKeys(await loadFormatDecks<DeckCards>(store, await formatRoots(store)));
  return { sources, onlineCards, ...whenPresent('formatCards', formatCards), newSets: newSetCodes(today) };
}

async function synonyms(store: Store): Promise<void> {
  await completedStage(store, 'synonyms', {
    inputs: await synonymInputs(store, new Date().toISOString().slice(0, 10)),
    revision: await builderRevision([
      '.github/scripts/update-card-synonyms.mjs',
      '.github/scripts/lib/build/onlineDecks.ts',
      '.github/scripts/lib/build/formatReports.ts',
      '.github/scripts/lib/setSeeds.ts',
      '.github/scripts/data/set-catalog.json'
    ]),
    force: boolEnv('FORCE_REFRESH'),
    run: async () => {
      run('.github/scripts/update-card-synonyms.mjs');
    }
  });
}

/**
 * The mirror discovers cards from every live event, the online release and
 * the formats release, so those roots are inputs: a card new to today's online
 * meta must rerun it even on a day the synonyms happen not to change.
 */
export async function imageInputs(store: Reader): Promise<Record<string, unknown>> {
  const { release, sources } = await loadEventSources(store);
  return {
    synonyms: content(await store.read('assets/card-synonyms.json')),
    sources,
    online: productionScopeRoot(release, 'online'),
    ...whenPresent('formats', releaseFormatsRoot(release))
  };
}

async function images(store: Store): Promise<void> {
  await completedStage(store, 'card-images', {
    inputs: await imageInputs(store),
    revision: await builderRevision([
      'scripts/convert-card-images.ts',
      'src/utils/ptcgio.ts',
      '.github/scripts/lib/build/formatReports.ts',
      '.github/scripts/lib/r2.mjs',
      '.github/scripts/lib/r2Inventory.mjs',
      '.github/scripts/build-art-groups.py'
    ]),
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
    revision: await builderRevision(['.github/scripts/scrape-archetype-icons.py']),
    run: async () => {
      run('.github/scripts/scrape-archetype-icons.py', ['--publish']);
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
    }
  });
  await completedStage(store, 'pokemon-sprites', {
    inputs: {
      icons: await store.read('assets/archetype-icons.json'),
      formats: await store.read('assets/format-archetypes.json')
    },
    force,
    revision: await builderRevision([
      'scripts/mirror-archetype-sprites.ts',
      '.github/scripts/lib/mirrorSprites.ts',
      '.github/scripts/lib/r2.mjs',
      '.github/scripts/lib/r2Inventory.mjs',
      'shared/pokemon/sprites.json'
    ]),
    run: async () => {
      run('scripts/mirror-archetype-sprites.ts', force ? ['--force'] : []);
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
