import { pathToFileURL } from 'node:url';
import { r2Config } from './lib/env';
import { createR2Client } from './lib/r2.mjs';
import { createR2ObjectStore } from './lib/build/r2ObjectStore.mjs';
import { type DeploymentStore, type PagesReader, reconcileDeployment } from './lib/build/deployment';
import { pagesReaderFromEnv } from './lib/build/pages';

interface PendingEventStore {
  get(key: string): Promise<string | null>;
  delete(key: string): Promise<void>;
}

interface LegacyCatalogStore {
  get(key: string): Promise<string | null>;
  put(key: string, body: string): Promise<void>;
}

/** Outside readers still fetch this mutable path; the site reads the release catalog. */
export const LEGACY_CATALOG_KEY = 'reports/tournaments.json';

/** Mirror the promoted release's tournament catalog to its pre-release path. */
export async function mirrorLegacyCatalog(
  store: LegacyCatalogStore,
  manifest: { roots: { catalogs: string } }
): Promise<void> {
  const key = `${manifest.roots.catalogs.replace(/^\/+/, '')}/tournaments.json`;
  const body = await store.get(key);
  if (body === null) {
    throw new Error(`Promoted release has no tournament catalog: ${key}`);
  }
  await store.put(LEGACY_CATALOG_KEY, body);
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

/**
 * Promote whatever Pages serves, then drop pending events it already carries.
 * A run that deployed but died before cleanup leaves them behind, and a stale
 * pending root would override production's after a rollback. The legacy
 * catalog mirror runs last so a failed copy never blocks promotion.
 */
export async function reconcileAndClear(
  store: DeploymentStore & PendingEventStore & LegacyCatalogStore,
  pages: PagesReader,
  expectedAttempt?: string,
  options?: Parameters<typeof reconcileDeployment>[3]
): Promise<{ releaseId: string; cleared: number }> {
  const manifest = await reconcileDeployment(store, pages, expectedAttempt, options);
  const cleared = await clearPromotedEvents(store, manifest, false);
  await mirrorLegacyCatalog(store, manifest);
  return { releaseId: manifest.releaseId, cleared };
}

async function main(): Promise<void> {
  const config = r2Config();
  const store = createR2ObjectStore(createR2Client(config), config.bucket);
  const { releaseId, cleared } = await reconcileAndClear(store, pagesReaderFromEnv(), process.argv[2]);
  console.log(`[update-channel] current.json -> release ${releaseId}`);
  console.log(`[update-channel] cleared ${cleared} promoted pending event(s)`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch(error => {
    console.error('[update-channel]', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
