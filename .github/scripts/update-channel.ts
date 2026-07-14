/**
 * Update a release channel pointer with an ETag-conditional write.
 *
 * The last step of promotion: point build/v1/channels/{channel}.json at the
 * just-deployed release. Uses the conditional update-with-replan so a concurrent
 * promotion cannot be clobbered. Runs AFTER the Pages deploy, so the deployed
 * bundle (which embeds the manifest) and this tooling pointer cannot diverge.
 *
 * Usage: tsx update-channel.ts --channel <shadow|production> --manifest <release-manifest.json>
 * @module .github/scripts/update-channel
 */

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { validateReleaseManifest } from '../../shared/data/build/release.ts';
import { updatePointer } from '../../shared/data/build/channel.ts';
import { createR2Client } from './lib/r2.mjs';
import { createR2ObjectStore } from './lib/build/r2ObjectStore.mjs';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const arg = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const channel = arg('--channel');
  const manifestPath = arg('--manifest');
  if (channel !== 'shadow' && channel !== 'production') throw new Error('--channel must be shadow|production');
  if (!manifestPath) throw new Error('Missing --manifest <release-manifest.json>');

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { releaseId: string };
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
  const manifestKey = `build/v1/releases/${manifest.releaseId}.json`;
  await store.put(manifestKey, JSON.stringify(manifest));
  console.log(`[update-channel] persisted manifest -> ${manifestKey}`);

  const key = `build/v1/channels/${channel}.json`;
  const written = await updatePointer(store, key, () => ({
    channel,
    releaseId: manifest.releaseId,
    promotedFrom: 'publish-data-release'
  }));
  console.log(`[update-channel] ${key} -> release ${(written as { releaseId: string })?.releaseId}`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch(error => {
    console.error('[update-channel]', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
