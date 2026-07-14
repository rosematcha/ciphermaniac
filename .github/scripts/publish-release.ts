/**
 * Compose an immutable release from built scope roots and emit the embed module.
 *
 * This runs after the build loop has published every scope's artifacts under
 * immutable `/releases/v1/…` roots. It composes the release manifest (unchanged
 * scopes reuse their prior roots), validates it, writes it, and generates
 * `src/generated/release.ts` so the subsequent `npm run build` and Pages
 * Functions bundle embed exactly this release. It does NOT touch the production
 * channel pointer — that is a separate, post-deploy, ETag-conditional step so
 * the deployed bundle and the tooling pointer can never diverge.
 *
 * Usage:
 *   tsx publish-release.ts --roots <roots.json> --served <served.json> --release-id <id> \
 *     --published-at <iso> --manifest-out <path> --module-out src/generated/release.ts [--events <events.json>]
 * @module .github/scripts/publish-release
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { composeRelease, type ReleaseScope } from '../../shared/data/build/release.ts';
import { renderModule } from './generate-release-module.ts';

interface Args {
  roots: string;
  releaseId: string;
  publishedAt: string;
  manifestOut: string;
  moduleOut: string;
  served: string;
  events?: string;
  dependencies?: string;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const args = {
    roots: get('--roots'),
    releaseId: get('--release-id'),
    publishedAt: get('--published-at'),
    manifestOut: get('--manifest-out'),
    moduleOut: get('--module-out') ?? 'src/generated/release.ts',
    served: get('--served'),
    events: get('--events'),
    dependencies: get('--dependencies')
  };
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined && ['roots', 'releaseId', 'publishedAt', 'manifestOut', 'served'].includes(key)) {
      throw new Error(`Missing required --${key.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`)}`);
    }
  }
  return args as Args;
}

async function loadJson<T>(path: string | undefined): Promise<T | undefined> {
  if (!path) return undefined;
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

/** Compose + validate the manifest and render the embed module (pure of I/O). */
export function buildReleaseArtifacts(input: {
  roots: Record<ReleaseScope, string>;
  served: Record<ReleaseScope, string[]>;
  releaseId: string;
  publishedAt: string;
  events?: Record<string, string>;
  dependencies?: Record<string, string>;
}): { manifest: ReturnType<typeof composeRelease>; module: string } {
  const manifest = composeRelease(input);
  return { manifest, module: renderModule(manifest) };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const roots = (await loadJson<Record<ReleaseScope, string>>(args.roots))!;
  const served = (await loadJson<Record<ReleaseScope, string[]>>(args.served))!;
  const events = await loadJson<Record<string, string>>(args.events);
  const dependencies = await loadJson<Record<string, string>>(args.dependencies);

  const { manifest, module } = buildReleaseArtifacts({ roots, served, releaseId: args.releaseId, publishedAt: args.publishedAt, events, dependencies });

  await mkdir(dirname(resolve(args.manifestOut)), { recursive: true });
  await writeFile(resolve(args.manifestOut), JSON.stringify(manifest, null, 2));
  await mkdir(dirname(resolve(args.moduleOut)), { recursive: true });
  await writeFile(resolve(args.moduleOut), module);
  console.log(`[publish-release] Composed release ${manifest.releaseId}; embedded module at ${args.moduleOut}`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch(error => {
    console.error('[publish-release]', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
