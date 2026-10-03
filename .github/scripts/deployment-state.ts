import { randomUUID } from 'node:crypto';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { EMBEDDED_RELEASE } from '../../shared/generated/release';
import { r2Config } from './lib/env';
import { createR2Client } from './lib/r2.mjs';
import { createR2ObjectStore } from './lib/build/r2ObjectStore.mjs';
import { persistCandidate, reconcileDeployment, recordAttempt, validatedManifest } from './lib/build/deployment';
import { pagesReaderFromEnv } from './lib/build/pages';

async function main(): Promise<void> {
  const config = r2Config();
  const store = createR2ObjectStore(createR2Client(config), config.bucket);
  const command = process.argv[2];
  if (command === 'reconcile') {
    await reconcileDeployment(store, pagesReaderFromEnv());
    return;
  }
  if (command === 'persist') {
    await persistCandidate(store, JSON.parse(await readFile('release-manifest.json', 'utf8')));
    return;
  }
  if (command !== 'attempt') {
    throw new Error('Expected reconcile, persist, or attempt');
  }
  const manifest = validatedManifest(EMBEDDED_RELEASE);
  const attemptId = randomUUID();
  await recordAttempt(store, manifest, attemptId, new Date().toISOString());
  await writeFile('dist/deployment-release.json', JSON.stringify({ attemptId, manifest }));
  await appendFile(process.env.GITHUB_OUTPUT!, `attempt-id=${attemptId}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
