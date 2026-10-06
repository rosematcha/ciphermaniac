/**
 * Report events ingested into pending-events.json that production does not serve yet.
 *
 * An ingest registers its event as pending, and only a successful publish
 * promotes it. When that publish fails, the event already counts as held, so
 * the watch finds nothing missing and nothing retries. This check reads R2
 * alone, so a publish retry does not wait on labs being reachable.
 */
import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { r2Config } from './lib/env';
import { createR2Client, readJson } from './lib/r2.mjs';
import { loadEventSources } from './lib/build/productionRelease';

export function unpublishedEvents(production: Record<string, string>, sources: Record<string, string>): string[] {
  return Object.keys(sources)
    .filter(folder => production[folder] !== sources[folder])
    .sort();
}

async function main(): Promise<void> {
  const config = r2Config();
  const client = createR2Client(config);
  const { release, sources } = await loadEventSources({ read: key => readJson(client, config.bucket, key) });
  const folders = unpublishedEvents(release.events, sources);
  for (const folder of folders) {
    console.log(`[unpublished] ${folder} is ingested but not in production; publishing`);
  }
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `unpublished=${folders.length > 0 ? folders.length : ''}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
