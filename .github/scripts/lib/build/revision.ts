import { readFile } from 'node:fs/promises';
import { inputFingerprint } from './provenance';

export async function builderRevision(paths: string[]): Promise<string> {
  return inputFingerprint(await Promise.all(paths.map(async path => [path, await readFile(path, 'utf8')])));
}

export const PLAYER_BUILD_FILES = [
  'shared/onlineMeta/playerAggregator.ts',
  'shared/onlineMeta/playerIdentity.ts',
  'shared/playerTypes.ts',
  'shared/cardUtils.ts',
  'shared/onlineMeta/tournamentFetcher.ts',
  'shared/onlineMeta/storageWriter.ts',
  '.github/scripts/run-player-aggregator.ts'
];
