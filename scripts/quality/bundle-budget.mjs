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
