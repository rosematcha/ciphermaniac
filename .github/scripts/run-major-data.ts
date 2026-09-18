import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { r2Config } from './lib/env';
import { createR2Client, getJsonResult, putJson } from './lib/r2.mjs';
import { loadEventSources } from './lib/build/productionRelease';
import { builderRevision, PLAYER_BUILD_FILES } from './lib/build/revision';
import { inputFingerprint, type ProducerState } from './lib/build/provenance';

export async function runMajorData(): Promise<void> {
  const config = r2Config();
  const client = createR2Client(config);
  const read = async <T>(key: string): Promise<T | null> => {
    const result = await getJsonResult<T>(client, config.bucket, key);
    if (result.status === 'found') {
      return result.value;
    }
    if (result.status === 'missing') {
      return null;
    }
    throw new Error(`Cannot read ${key}: ${result.status}`);
  };
  const { sources } = await loadEventSources({ read });
  const inputs = inputFingerprint(sources);
  const codeRevision = await builderRevision([
    ...PLAYER_BUILD_FILES,
    '.github/scripts/run-majors-trends.ts',
    'src/lib/majorsTrends.ts'
  ]);
  const revision = inputFingerprint({ codeRevision, synonyms: await read('assets/card-synonyms.json') });
  const key = 'build/v1/producers/majors.json';
  const previous = await read<ProducerState>(key);
  if (
    previous?.status === 'complete' &&
    previous.inputs === inputs &&
    previous.revision === revision &&
    process.env.FORCE_FULL_REBUILD !== 'true'
  ) {
    console.log('[majors] Reusing completed players and majors trends; event inputs unchanged');
    return;
  }
  await putJson(client, config.bucket, key, { status: 'building', inputs, revision });
  for (const script of ['run-player-aggregator.ts', 'run-majors-trends.ts']) {
    execFileSync(process.execPath, ['--import', 'tsx', `.github/scripts/${script}`], { stdio: 'inherit' });
  }
  const manifest = await read<{ fingerprints?: Record<string, string> }>('players/_manifest.json');
  if (inputFingerprint(manifest?.fingerprints ?? {}) !== inputs) {
    throw new Error('Player aggregation did not cover every selected event');
  }
  await putJson(client, config.bucket, key, { status: 'complete', inputs, revision });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMajorData().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
