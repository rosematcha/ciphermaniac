/**
 * Embed the CURRENT production release manifest before an app build.
 *
 * Run as the first step of the Cloudflare Pages build command for git-integrated
 * (source) deployments. It reads the public production channel pointer, fetches
 * that release's persisted manifest, and writes `shared/generated/release.ts` so the
 * source build embeds the SAME manifest production is already serving — instead
 * of the committed `null` default, which would silently revert the data cutover.
 *
 * Missing or invalid release state fails the build. The release workflow itself
 * does NOT use this script — it generates the module from the
 * freshly composed manifest and deploys via direct upload, so the two paths can
 * never fight over the module.
 *
 * Usage: tsx embed-current-release.ts [--out shared/generated/release.ts]
 *   DATA_BASE (default https://r2.ciphermaniac.com) — public bucket origin.
 *   CHANNEL   (default production) — channel pointer to follow.
 * @module .github/scripts/embed-current-release
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateReleaseManifest } from '../../shared/data/build/release.ts';
import { renderModule } from './generate-release-module.ts';

const DEFAULT_OUT = 'shared/generated/release.ts';

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
    if (!res.ok) {
      return null;
    }
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

/** Resolve and validate the selected channel's current manifest. */
export async function resolveCurrentManifest(dataBase: string, channel: string): Promise<unknown | null> {
  const base = dataBase.replace(/\/+$/, '');
  const pointerKey = channel === 'production' ? 'current.json' : `channels/${channel}.json`;
  const pointer = (await fetchJson(`${base}/${pointerKey}`)) as {
    releaseId?: unknown;
    manifest?: unknown;
  } | null;
  const releaseId = pointer && typeof pointer.releaseId === 'string' ? pointer.releaseId : null;
  if (!releaseId) {
    return null;
  }
  const manifestPath =
    typeof pointer?.manifest === 'string'
      ? pointer.manifest
      : `/releases/v1/manifests/${encodeURIComponent(releaseId)}.json`;
  const manifest = await fetchJson(`${base}/${manifestPath.replace(/^\/+/, '')}`);
  if (manifest === null) {
    return null;
  }
  return validateReleaseManifest(manifest).length === 0 ? manifest : null;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const outIndex = argv.indexOf('--out');
  const out = resolve(outIndex >= 0 ? argv[outIndex + 1] : DEFAULT_OUT);
  const dataBase = process.env.DATA_BASE ?? 'https://r2.ciphermaniac.com';
  const channel = process.env.CHANNEL ?? 'production';

  const manifest = await resolveCurrentManifest(dataBase, channel);
  if (!manifest) {
    throw new Error(`No valid ${channel} release is available at ${dataBase}`);
  }
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, renderModule(manifest));

  const label = (manifest as { releaseId: string }).releaseId;
  console.log(`[embed-current-release] embedded ${label} at ${out}`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch(error => {
    console.error('[embed-current-release]', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
