import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { r2Config } from './lib/env';
import { createR2Client } from './lib/r2.mjs';
import { createR2ObjectStore } from './lib/build/r2ObjectStore.mjs';
import { type DeploymentStore, type PagesReader, reconcileDeployment } from './lib/build/deployment';
import { pagesReaderFromEnv } from './lib/build/pages';
import { renderModule } from './generate-release-module';

export async function prepareDeployment(
  store: DeploymentStore,
  pages: PagesReader,
  output = 'shared/generated/release.ts'
): Promise<void> {
  const manifest = await reconcileDeployment(store, pages);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, renderModule(manifest));
  console.log(`Embedded reconciled production release ${manifest.releaseId}`);
}

async function main(): Promise<void> {
  const config = r2Config();
  const store = createR2ObjectStore(createR2Client(config), config.bucket);
  await prepareDeployment(store, pagesReaderFromEnv());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
