import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

/** Follow static imports only: a lazy route must not inflate the initial budget. */
export function entryFiles(manifest, entry) {
  const pending = [entry];
  const visited = new Set();
  const files = new Set();
  while (pending.length) {
    const key = pending.pop();
    if (visited.has(key)) {
      continue;
    }
    visited.add(key);
    const chunk = manifest[key];
    if (!chunk) {
      throw new Error(`Missing manifest entry: ${key}`);
    }
    files.add(chunk.file);
    for (const css of chunk.css ?? []) {
      files.add(css);
    }
    pending.push(...(chunk.imports ?? []));
  }
  return files;
}

/** The embedded release manifest's chunk: data that grows with every event, budgeted apart from code. */
const RELEASE_CHUNK = 'release';

/** Files of the release chunk, taken out of the code measurements and measured on their own. */
export function splitRelease(manifest, files) {
  const release = new Set(
    Object.values(manifest)
      .filter(chunk => chunk.name === RELEASE_CHUNK)
      .map(chunk => chunk.file)
  );
  return {
    code: new Set([...files].filter(file => !release.has(file))),
    release: new Set([...files].filter(file => release.has(file)))
  };
}

export function compressedSizes(directory, files) {
  const sizes = { js: 0, css: 0 };
  for (const file of files) {
    const extension = file.split('.').pop();
    if (extension === 'js' || extension === 'css') {
      sizes[extension] += gzipSync(readFileSync(join(directory, file))).byteLength;
    }
  }
  return sizes;
}

export function budgetFailures(measurements, budgets) {
  return Object.entries(measurements).flatMap(([name, actual]) => {
    const limit = budgets[name];
    if (!Number.isFinite(limit) || limit <= 0) {
      return [`${name}: missing or invalid budget`];
    }
    return actual > limit ? [`${name}: ${actual} gzip bytes exceeds ${limit}`] : [];
  });
}
