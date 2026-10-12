import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { parseTdf, writeTdf } from '../shared/tournament/tdf.js';

function tdfFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return tdfFiles(path);
    }
    return entry.name.endsWith('.tdf') ? [path] : [];
  });
}

const directory = process.argv[2];
if (!directory) {
  throw new Error('Usage: tsx scripts/tournament-round-trip.ts <directory>');
}
const files = tdfFiles(resolve(directory));
if (!files.length) {
  throw new Error('No TDF files found');
}
// Report counts only: filenames and contents can identify real players.
const failures = files.filter(path => {
  const source = readFileSync(path);
  return !source.equals(Buffer.from(writeTdf(parseTdf(source.toString('utf8')))));
});
process.stdout.write(`${files.length - failures.length}/${files.length} files round-trip byte-for-byte\n`);
if (failures.length) {
  process.exitCode = 1;
}
