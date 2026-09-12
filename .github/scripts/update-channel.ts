/**
 * Update a release channel pointer with an ETag-conditional write.
 *
 * The last step of promotion: update the channel's single current pointer to the
 * just-deployed release. Uses the conditional update-with-replan so a concurrent
 * promotion cannot be clobbered. Runs AFTER the Pages deploy, so the deployed
 * bundle (which embeds the manifest) and this tooling pointer cannot diverge.
 *
 * Usage: tsx update-channel.ts --manifest <release-manifest.json>
 * @module .github/scripts/update-channel
 */

import { requireEnv } from './lib/env.ts';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { type ReleaseManifest, validateReleaseManifest } from '../../shared/data/build/release.ts';
import { updatePointer } from '../../shared/data/build/channel.ts';
import { createR2Client } from './lib/r2.mjs';
import { createR2ObjectStore } from './lib/build/r2ObjectStore.mjs';

interface PendingEventStore {
  get(key: string): Promise<string | null>;
  delete(key: string): Promise<void>;
}

export async function clearPromotedEvents(
  store: PendingEventStore,
  manifest: { events?: Record<string, string> }
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
    throw new Error(`Refusing to clear unpromoted events: ${missing.join(', ')}`);
  }
  await store.delete('pending-events.json');
  return folders.length;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const arg = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const manifestPath = arg('--manifest');
  if (!manifestPath) {
    throw new Error('Missing --manifest <release-manifest.json>');
  }

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as ReleaseManifest;
  const errors = validateReleaseManifest(manifest);
  if (errors.length > 0) {
    throw new Error(`Refusing to promote an invalid manifest:\n  ${errors.join('\n  ')}`);
  }

  const client = createR2Client({
    accountId: requireEnv('R2_ACCOUNT_ID'),
    accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY')
  });
  const store = createR2ObjectStore(client, requireEnv('R2_BUCKET_NAME'));

  // Persist the full manifest at a stable public key BEFORE flipping the pointer,
  // so any git-integrated source build (which re-embeds the current pointer's
  // manifest at build time) can always fetch it. Keyed by releaseId, so it is
  // effectively immutable and safe to write once.
  const manifestKey = `releases/v1/manifests/${manifest.releaseId}.json`;
  await store.put(manifestKey, JSON.stringify(manifest));
  console.log(`[update-channel] persisted manifest -> ${manifestKey}`);

  const channel = 'production';
  const key = 'current.json';
  const written = await updatePointer(store, key, () => ({
    channel,
    releaseId: manifest.releaseId,
    manifest: `/${manifestKey}`,
    promotedFrom: 'publish-data-release'
  }));
  console.log(`[update-channel] ${key} -> release ${(written as { releaseId: string })?.releaseId}`);
  const cleared = await clearPromotedEvents(store, manifest);
  console.log(`[update-channel] cleared ${cleared} promoted pending event(s)`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch(error => {
    console.error('[update-channel]', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
