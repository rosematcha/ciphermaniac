import type { ReleaseManifest } from '../../../../shared/data/build/release.ts';
import { FORMATS_ROOT } from '../../../../shared/formats/registry.ts';

interface JsonReader {
  read<T>(key: string): Promise<T | null>;
}

// One or more slash-separated folder segments, never `..` or an absolute path.
const FORMAT_ID = /^[\w-]+(?:\/[\w-]+)*$/;

function formatId(entry: unknown): string {
  const id = (entry as { id?: unknown } | null)?.id;
  if (typeof id !== 'string' || !FORMAT_ID.test(id)) {
    throw new Error(`Invalid formats index entry: ${JSON.stringify(entry)}`);
  }
  return id;
}

/**
 * Report folders of every published format under `root`, without a trailing
 * slash. A missing index means no format has been published yet.
 */
export async function formatRoots(reader: JsonReader, root = FORMATS_ROOT): Promise<string[]> {
  const index = await reader.read<{ formats?: unknown }>(`${root}/index.json`);
  if (index === null) {
    return [];
  }
  if (!Array.isArray(index.formats)) {
    throw new Error('Invalid formats index');
  }
  return index.formats.map(entry => `${root}/${formatId(entry)}`);
}

/**
 * The release's formats root as a bucket key, or null for a release that
 * carries no formats scope (every release before the scope existed).
 */
export function releaseFormatsRoot(manifest: ReleaseManifest): string | null {
  const root = manifest.roots.formats?.replace(/^\/+/, '').replace(/\/+$/, '');
  return root || null;
}

/** Format report folders of a release; none when the release has no formats scope. */
export async function releaseFormatRoots(reader: JsonReader, manifest: ReleaseManifest): Promise<string[]> {
  const root = releaseFormatsRoot(manifest);
  return root === null ? [] : formatRoots(reader, root);
}
