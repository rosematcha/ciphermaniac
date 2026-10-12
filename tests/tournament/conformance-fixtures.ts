import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';

const archive = resolve('tests/fixtures/tom-conformance/tom-1.86.0-conformance-v25.tar.zst');
export const fixtureCache = resolve('.cache/tom-1.86.0-v25');
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const ARCHIVE_SHA256 = 'a0b87a3ff4fdd629df0b65b6360d12b8cc35bd15996cd3f173f8922b8ca7e2fb';

const GNU_LONG_NAME = 76;
const nulTerminated = (bytes: Buffer) => bytes.toString('utf8').replace(/\0.*$/s, '');

/** Extract regular files only; validate paths before touching the ignored cache. */
function extractTar(tar: Buffer, cache: string, names: RegExp): void {
  let longName: string | undefined;
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) {
      break;
    }
    const size = Number.parseInt(header.subarray(124, 136).toString('ascii'), 8);
    assert.ok(Number.isSafeInteger(size) && size >= 0 && offset + 512 + size <= tar.length);
    if (header[156] === GNU_LONG_NAME) {
      longName = nulTerminated(tar.subarray(offset + 512, offset + 512 + size));
      offset += 512 + Math.ceil(size / 512) * 512;
      continue;
    }
    const name = longName ?? nulTerminated(header.subarray(0, 100));
    longName = undefined;
    assert.match(name, names);
    assert.ok(!name.split('/').includes('..'), `Unsafe archive path: ${name}`);
    if (header[156] === 48 || header[156] === 0) {
      const target = join(cache, name);
      mkdirSync(dirname(target), { recursive: true });
      const temporary = `${target}.${process.pid}.tmp`;
      writeFileSync(temporary, tar.subarray(offset + 512, offset + 512 + size));
      renameSync(temporary, target);
    } else {
      assert.equal(header[156], 53, 'Archive must contain only files and directories');
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
}

export interface FixturePlayer {
  id: number;
  firstName: string;
  lastName: string;
  birthYear: number;
  byes?: number;
  staticSeat?: number;
}
export interface FixtureMatch {
  players: number[];
  outcome: number;
  table: number;
  timestamp: string;
}
export interface ObservedRound {
  number: number;
  type: number;
  stage: number;
  matches: FixtureMatch[];
  timeLeft: number;
  pairedAt: string;
  startedAt: string;
}
export interface ObservedPod {
  category: number;
  stage: number;
  flights: { number: number; players: number[] }[];
  rounds: ObservedRound[];
}
export interface FixtureOperation {
  op: string;
  fixture: string;
  sha256: string;
  observed: {
    stage: number;
    rosterOrder: number[];
    pods: ObservedPod[];
    eventDate: string;
    elapsedSeconds: number;
  };
  name?: string;
  type?: number;
  game?: string;
  mode?: string;
  players?: FixturePlayer[];
  pod?: number;
  cut?: number;
  divisionCuts?: string;
  head_to_head_order?: { category: number; players: number[] }[];
  flights?: number;
  lessSwiss?: boolean;
  additionalRounds?: number;
  thirdPlace?: boolean;
  manualTables?: boolean;
  blockedTable?: number;
  roundMinutes?: number;
  finalMinutes?: number;
  repair?: boolean;
  player?: number;
  status?: number;
  expectRejected?: boolean;
  select?: string;
  id?: number;
  firstName?: string;
  lastName?: string;
  birthYear?: number;
  outcomes?: string;
  eliminationOutcomes?: string;
  overwrite?: boolean;
  results?: FixtureMatch[];
  timestamp?: string;
  markLate?: boolean;
  forcedLoss?: boolean;
  table?: number;
  expectedPairing?: string;
  pairingResult?: string;
  retainedTables?: number[];
  blockedRanges?: string;
  overflowTable?: number;
  round?: number;
  match?: number;
  seconds?: number;
  elimination_tie_order?: { category: number; players: number[] }[];
  finishResult?: string;
  expectedFinish?: string;
  saveResult?: string;
  failedSaveFixture?: string;
  failedSaveSha256?: string;
  wizard?: boolean;
  disqualified_name_order?: { category: number; players: number[] }[];
}
export interface FixtureScenario {
  formatVersion: number;
  id: string;
  covers: string[];
  operations: FixtureOperation[];
}

const scenarioRoots = new WeakMap<FixtureScenario, string>();
const v25Root = join(fixtureCache, 'conformance-v25');

/** Scenario directories of an extracted corpus, in name order. */
export function scenarioIds(root: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter(entry => !entry.isFile() && existsSync(join(root, entry.name, 'scenario.json')))
    .map(entry => entry.name)
    .sort();
}

/** Read one scenario and verify every checkpoint's recorded hash before it can be replayed. */
export function readScenario(root: string, id: string): FixtureScenario {
  const scenario = JSON.parse(readFileSync(join(root, id, 'scenario.json'), 'utf8')) as FixtureScenario;
  scenarioRoots.set(scenario, root);
  assert.equal(scenario.id, id);
  assert.equal(scenario.formatVersion, 1);
  for (const operation of scenario.operations) {
    assert.match(operation.fixture, /^[0-9]{4}-[a-z-]+\.tdf$/);
    assert.equal(digest(fixtureBytes(scenario, operation)), operation.sha256, `${id}/${operation.fixture}`);
    if (operation.failedSaveFixture) {
      assert.match(operation.failedSaveFixture, /^[0-9]{4}-[a-z-]+\.partial$/);
      assert.equal(digest(readFileSync(join(root, id, operation.failedSaveFixture))), operation.failedSaveSha256);
    }
  }
  return scenario;
}

export function loadScenarios(): FixtureScenario[] {
  const bytes = readFileSync(archive);
  assert.equal(digest(bytes), ARCHIVE_SHA256, 'The original archive must remain unchanged');
  const marker = join(fixtureCache, '.archive-sha256');
  if (!existsSync(marker) || readFileSync(marker, 'utf8') !== ARCHIVE_SHA256) {
    extractTar(zstdDecompressSync(bytes), fixtureCache, /^conformance-v25\/(?:[a-z0-9_./-]*|SPEC\.md|PAIRING\.md)$/);
    writeFileSync(marker, ARCHIVE_SHA256);
  }
  const scenarios = scenarioIds(v25Root).map(id => readScenario(v25Root, id));
  assert.equal(scenarios.length, 606, 'Never silently drop scenarios');
  assert.equal(
    scenarios.reduce((count, s) => count + s.operations.length, 0),
    13937
  );
  return scenarios;
}

/**
 * One minimized bulk-corpus scenario kept as a regression fixture: `bulk-regressions/<id>.tar.zst` holds
 * `<id>/scenario.json` and its checkpoints, extracted once into the ignored cache.
 */
export function loadRegression(id: string, sha256: string): FixtureScenario {
  assert.match(id, /^(?:b[xy][1-7]-[a-z]+|s1|s[23](?:-[a-z]+)+|c1|c[23](?:-[a-z]+)+)-[0-9]+$/);
  const bytes = readFileSync(resolve(`tests/fixtures/tom-conformance/bulk-regressions/${id}.tar.zst`));
  assert.equal(digest(bytes), sha256, `The ${id} regression archive must remain unchanged`);
  const cache = resolve('.cache/tom-bulk-regressions');
  const marker = join(cache, `${id}.archive-sha256`);
  if (!existsSync(marker) || readFileSync(marker, 'utf8') !== sha256 || !existsSync(join(cache, id, 'scenario.json'))) {
    extractTar(zstdDecompressSync(bytes), cache, new RegExp(`^${id}/(?:[a-z0-9_.-]+)?$`));
    writeFileSync(marker, sha256);
  }
  return readScenario(cache, id);
}

export function fixtureBytes(scenario: FixtureScenario, operation: FixtureOperation): Buffer {
  return readFileSync(join(scenarioRoots.get(scenario) ?? v25Root, scenario.id, operation.fixture));
}
