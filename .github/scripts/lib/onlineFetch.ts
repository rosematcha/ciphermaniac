import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fetchLimitlessJson as fetchRemote } from '../../../shared/api/limitless';
import { inputFingerprint } from './build/provenance';

/** Per-run acquisition cache shared by the 14-day meta and 30–90-day trends producers. */
export async function fetchLimitlessJson(
  path: string,
  options: Parameters<typeof fetchRemote>[1] = {}
): Promise<unknown> {
  const directory = process.env.ONLINE_FETCH_CACHE;
  if (!directory) {
    return fetchRemote(path, options);
  }
  const params = options.searchParams instanceof URLSearchParams ? [...options.searchParams] : options.searchParams;
  const key = join(directory, `${inputFingerprint({ path, params: params ?? null })}.json`);
  try {
    return JSON.parse(await readFile(key, 'utf8')) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
  const value = await fetchRemote(path, options);
  await mkdir(directory, { recursive: true });
  const temporary = `${key}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value));
  await rename(temporary, key);
  return value;
}
