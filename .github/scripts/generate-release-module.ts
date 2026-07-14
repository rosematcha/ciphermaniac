/**
 * Generate the embedded-release module consumed by the app build.
 *
 * Reads a validated release manifest and writes `src/generated/release.ts`
 * exporting it, so `npm run build` and the Pages Functions bundle embed the
 * exact release. The committed default exports `null` (legacy fallback); the
 * production/shadow workflow regenerates this file before building and does NOT
 * commit the generated production release id to main.
 *
 * Usage: tsx generate-release-module.ts <manifest.json> [--out src/generated/release.ts]
 * @module .github/scripts/generate-release-module
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateReleaseManifest } from '../../shared/data/build/release.ts';

const DEFAULT_OUT = 'src/generated/release.ts';

export function renderModule(manifest: unknown): string {
  const body = manifest === null ? 'null' : JSON.stringify(manifest, null, 2);
  return `/**
 * GENERATED — do not edit. Written by .github/scripts/generate-release-module.ts.
 * The committed default is \`null\` (legacy path resolution); the release
 * workflow overwrites this with the immutable manifest before building.
 */
import type { ReleaseManifest } from '../../shared/data/build/release';

export const EMBEDDED_RELEASE: ReleaseManifest | null = ${body};
`;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const manifestPath = argv.find(arg => !arg.startsWith('--'));
  const outIndex = argv.indexOf('--out');
  const out = resolve(outIndex >= 0 ? argv[outIndex + 1] : DEFAULT_OUT);

  if (!manifestPath) throw new Error('Usage: generate-release-module.ts <manifest.json> [--out <path>]');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown;
  const errors = validateReleaseManifest(manifest);
  if (errors.length > 0) throw new Error(`Refusing to embed an invalid manifest:\n  ${errors.join('\n  ')}`);

  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, renderModule(manifest));
  console.log(`[release-module] Wrote ${out} for release ${(manifest as { releaseId: string }).releaseId}`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch(error => {
    console.error('[release-module]', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
