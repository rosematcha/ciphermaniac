import { pathToFileURL } from 'node:url';
import { r2Config } from './lib/env';
import { createR2Client } from './lib/r2.mjs';
import { createR2ObjectStore } from './lib/build/r2ObjectStore.mjs';
import { reconcileDeployment } from './lib/build/deployment';
import { pagesReaderFromEnv } from './lib/build/pages';

interface PendingEventStore {
  get(key: string): Promise<string | null>;
  delete(key: string): Promise<void>;
}

export async function clearPromotedEvents(
  store: PendingEventStore,
  manifest: { events?: Record<string, string> },
  requireAll = true
): Promise<number> {
  const body = await store.get('pending-events.json');
  if (body === null) {
    return 0;
  }
  const pending = JSON.parse(body) as { events?: Record<string, unknown> };
  if (!pending.events || typeof pending.events !== 'object' || Array.isArray(pending.events)) {
    throw new Error('Pending event pointer is invalid');
  }
  const folders = Object.keys(pending.events);
  const missing = folders.filter(folder => manifest.events?.[folder] !== pending.events?.[folder]);
  if (missing.length > 0) {
    if (requireAll) {
      throw new Error(`Refusing to clear unpromoted events: ${missing.join(', ')}`);
    }
    return 0;
  }
  await store.delete('pending-events.json');
  return folders.length;
}

async function main(): Promise<void> {
  const config = r2Config();
  const store = createR2ObjectStore(createR2Client(config), config.bucket);
  const manifest = await reconcileDeployment(store, pagesReaderFromEnv(), process.argv[2]);
  console.log(`[update-channel] current.json -> release ${manifest.releaseId}`);
  const cleared = await clearPromotedEvents(store, manifest, false);
  console.log(`[update-channel] cleared ${cleared} promoted pending event(s)`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch(error => {
    console.error('[update-channel]', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
