/**
 * Embed the CURRENT production release manifest before an app build.
 *
 * Run as the first step of the Cloudflare Pages build command for git-integrated
 * (source) deployments. It reads the public production channel pointer, fetches
 * that release's persisted manifest, and writes `src/generated/release.ts` so the
 * source build embeds the SAME manifest production is already serving — instead
 * of the committed `null` default, which would silently revert the data cutover.
 *
 * Fail-safe: any missing pointer, missing/invalid manifest, or network error
 * writes the `null` (legacy) module rather than failing the build. The release
 * workflow itself does NOT use this script — it generates the module from the
 * freshly composed manifest and deploys via direct upload, so the two paths can
 * never fight over the module.
 *
 * Usage: tsx embed-current-release.ts [--out src/generated/release.ts]
 *   DATA_BASE (default https://r2.ciphermaniac.com) — public bucket origin.
 *   CHANNEL   (default production) — channel pointer to follow.
 * @module .github/scripts/embed-current-release
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateReleaseManifest } from '../../shared/data/build/release.ts';
import { renderModule } from './generate-release-module.ts';

const DEFAULT_OUT = 'src/generated/release.ts';

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

/** Resolve the current production manifest, or null when none is promoted. */
export async function resolveCurrentManifest(dataBase: string, channel: string): Promise<unknown | null> {
  const base = dataBase.replace(/\/+$/, '');
  const pointer = (await fetchJson(`${base}/build/v1/channels/${channel}.json`)) as { releaseId?: unknown } | null;
  const releaseId = pointer && typeof pointer.releaseId === 'string' ? pointer.releaseId : null;
  if (!releaseId) return null;
  const manifest = await fetchJson(`${base}/build/v1/releases/${encodeURIComponent(releaseId)}.json`);
  if (manifest === null) return null;
  return validateReleaseManifest(manifest).length === 0 ? manifest : null;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const outIndex = argv.indexOf('--out');
  const out = resolve(outIndex >= 0 ? argv[outIndex + 1] : DEFAULT_OUT);
  const dataBase = process.env.DATA_BASE ?? 'https://r2.ciphermaniac.com';
  const channel = process.env.CHANNEL ?? 'production';

  const manifest = await resolveCurrentManifest(dataBase, channel);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, renderModule(manifest));

  const label = manifest ? (manifest as { releaseId: string }).releaseId : 'null (legacy — no promoted release)';
  console.log(`[embed-current-release] embedded ${label} at ${out}`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch(error => {
    // Never fail the build for this: fall back to the committed legacy module.
    console.error('[embed-current-release] non-fatal:', error instanceof Error ? error.message : error);
    process.exit(0);
  });
}
