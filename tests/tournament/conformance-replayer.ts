import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { emptyTournament } from '../../shared/tournament/create.ts';
import { applyLifecycleOperation } from '../../shared/tournament/lifecycle.ts';
import type { LifecycleContext, LifecycleOperation, RecordedChoices } from '../../shared/tournament/lifecycleTypes.ts';
import { activeIds, fullRoundSeconds, latestRound, regularRounds } from '../../shared/tournament/rounds.ts';
import { packRepairTables, prepareTables, tableCeiling } from '../../shared/tournament/lifecycleTables.ts';
import { seededRandom } from '../../shared/tournament/random.ts';
import { survivorList } from '../../shared/tournament/lifecycleSurvivors.ts';
import { parseTdf, writeTdf } from '../../shared/tournament/tdf.ts';
import type { Match, Outcome, PodCategory, Tournament } from '../../shared/tournament/types.ts';
import {
  fixtureBytes,
  type FixtureMatch,
  type FixtureOperation,
  type FixtureScenario
} from './conformance-fixtures.ts';

import { answeredCheckpoint, questionSuffix, REPLAY_QUESTIONS } from './conformance-questions.ts';

const categories: Record<number, PodCategory> = {
  0: 'junior',
  1: 'senior',
  2: 'masters',
  8: 'junior-senior',
  9: 'senior-masters',
  10: 'mixed'
};
const outcomes: Record<number, Outcome> = {
  0: 'pending',
  1: 'p1',
  2: 'p2',
  3: 'tie',
  4: 'assigned-bye',
  5: 'bye',
  8: 'loss',
  9: 'deleted',
  10: 'double-loss'
};
const localTime = '10/01/2026 12:00:00';
const now = Date.UTC(2026, 9, 1, 12);

function matchOf(match: FixtureMatch): Match {
  return {
    p1: String(match.players[0]),
    p2: match.players[1] === undefined ? null : String(match.players[1]),
    outcome: outcomes[match.outcome]!,
    table: match.table,
    timestamp: match.timestamp
  };
}

/** Only an uninterrupted list is a choice; after reopening, a recorded list asserts saved roster order. */
function disqualifiedNameOrder(op: FixtureOperation, reopened: boolean): RecordedChoices {
  const lists = op.disqualified_name_order;
  return lists && !reopened ? { disqualifiedNameOrder: lists.map(list => list.players.map(String)) } : {};
}

/** V16-5 permits inferring the hidden pairing-search dissolution from recorded free and used tables. */
function heldRepairChoices(t: Tournament, op: FixtureOperation, flightIds?: readonly string[]): number[] {
  if (!op.repair) {
    return [];
  }
  const category = op.pod === undefined ? undefined : categories[op.pod];
  const prepared = op.op === 'probe-pair' ? t : prepareTables(packRepairTables(t, category), category);
  return prepared.pods
    .filter(p => category === undefined || p.category === category)
    .flatMap(pod => {
      const matches = op.observed.pods.find(p => categories[p.category] === pod.category)?.rounds.at(-1)?.matches ?? [];
      const flightMatches = flightIds ? matches.filter(m => flightIds.includes(String(m.players[0]))) : matches;
      const used = new Set(flightMatches.map(m => m.table));
      const ceiling = tableCeiling(prepared, pod) ?? Infinity;
      const fixed = prepared.players.filter(p => pod.playerIds.includes(p.id)).map(p => p.fixedTable);
      return (latestRound(pod)?.matches ?? [])
        .filter(
          m =>
            m.p2 !== null &&
            (!flightIds || flightIds.includes(m.p1)) &&
            !op.retainedTables?.includes(m.table) &&
            !used.has(m.table) &&
            m.table >= pod.startingTable &&
            m.table <= ceiling &&
            !fixed.includes(m.table) &&
            !pod.blockedRanges?.some(r => m.table >= r.start && m.table <= r.end) &&
            flightMatches.some(
              f => f.players.length === 2 && !op.retainedTables?.includes(f.table) && f.table > m.table
            )
        )
        .map(m => m.table);
    });
}

/** Terminal repair fixtures omit retainedTables; unchanged matches identify their surviving random choices. */
function repairTables(t: Tournament, op: FixtureOperation): number[] | undefined {
  if (!op.repair || op.retainedTables !== undefined) {
    return op.retainedTables;
  }
  return t.pods
    .filter(p => op.pod === undefined || categories[op.pod] === p.category)
    .flatMap(p => {
      const observed = op.observed.pods.find(o => categories[o.category] === p.category)?.rounds.at(-1)?.matches ?? [];
      const ceiling = tableCeiling(t, p) ?? Infinity;
      return (latestRound(p)?.matches ?? []).flatMap(m => {
        const match = observed.find(
          o => String(o.players[0]) === m.p1 && String(o.players[1]) === m.p2 && outcomes[o.outcome] === m.outcome
        );
        const moved = m.table < p.startingTable || m.table > ceiling;
        // V18-3: a re-formed match is pending, so a decided one with its result survived, wherever it moved (V18-9).
        const decided = m.outcome !== 'pending';
        return m.p2 !== null && match && (match.table === m.table || moved || decided) ? [match.table] : [];
      });
    });
}

/**
 * V20-1: a departure before start keeps its Swiss match only in a round searched since the last reopening;
 * the checkpoint that still holds the match is the recorded choice.
 */
function keptDepartureMatch(op: FixtureOperation, t: Tournament, searched: ReadonlySet<PodCategory>): boolean {
  const id = String(op.player);
  const pod = t.pods.find(p => p.playerIds.includes(id));
  const last = pod && latestRound(pod);
  const holds = (players: readonly (string | number | null)[]) => players.map(String).includes(id);
  if (op.op !== 'drop' || !pod || !searched.has(pod.category) || last?.kind !== 'swiss' || (last.stage ?? 4) >= 4) {
    return false;
  }
  const saved = op.observed.pods.find(p => categories[p.category] === pod.category)?.rounds.at(-1);
  return (
    last.matches.some(m => m.outcome === 'pending' && holds([m.p1, m.p2])) &&
    saved?.number === last.number &&
    saved.matches.some(m => holds(m.players))
  );
}

/** V18-3: a repaired round that keeps its stage of 5 or later took its dissolved matches apart in the pool's pairing. */
function takenApart(tournament: Tournament, op: FixtureOperation): boolean {
  return (
    Boolean(op.repair) &&
    tournament.pods.some(pod => {
      const before = latestRound(pod)?.stage ?? 0;
      const after = op.observed.pods.find(p => categories[p.category] === pod.category)?.rounds.at(-1)?.stage;
      return (op.pod === undefined || categories[op.pod] === pod.category) && before >= 5 && after === before;
    })
  );
}

function choices(op: FixtureOperation, reopened: boolean, tournament: Tournament): RecordedChoices {
  const retainedTables = repairTables(tournament, op);
  const repair = { ...op, retainedTables };
  const atPairing =
    ['start', 'pair', 'probe-pair'].includes(op.op) &&
    (!op.pairingResult || ['paired', 'repaired'].includes(op.pairingResult) || appendedRound(tournament, op));
  return {
    ...disqualifiedNameOrder(op, reopened),
    partialRepair: partialRepairChoice(tournament, op),
    heldRepairTables: heldRepairChoices(tournament, repair),
    heldRepairTablesByFlight: Object.fromEntries(
      tournament.pods.map(p => [
        p.category,
        Object.fromEntries((p.flights ?? []).map(f => [f.number, heldRepairChoices(tournament, repair, f.playerIds)]))
      ])
    ),
    eliminationTieOrder: op.elimination_tie_order?.map(group => ({
      category: categories[group.category]!,
      playerIds: group.players.map(String)
    })),
    takenApart: takenApart(tournament, op),
    repairError: op.saveResult === 'failed' && ['internal-error', 'pairing-error'].includes(op.pairingResult ?? ''),
    noRound:
      op.op === 'probe-pair' &&
      !op.repair &&
      op.pairingResult === 'no-round' &&
      !appendedRound(tournament, op) &&
      tournament.pods
        .filter(p => op.pod === undefined || categories[op.pod] === p.category)
        .every(
          p =>
            latestRound(p)?.kind === 'swiss' &&
            !(p.cut > 0 && latestRound(p)!.number >= regularRounds(tournament, p) && (latestRound(p)!.stage ?? 0) >= 5)
        ),
    ...(op.repair && op.pairingResult === 'pairing-error' && !op.saveResult
      ? {
          abortedRepair: Object.fromEntries(
            op.observed.pods.map(p => [categories[p.category], p.rounds.at(-1)!.matches.map(matchOf)])
          )
        }
      : {}),
    ...(op.head_to_head_order
      ? {
          headToHeadOrder: op.head_to_head_order.map(group => ({
            category: categories[group.category]!,
            playerIds: group.players.map(String)
          }))
        }
      : {}),
    ...(op.repair
      ? {
          retainedTables,
          retainedPairings: op.observed.pods
            .filter(p => op.pod === undefined || op.pod === p.category)
            .flatMap(p =>
              (p.rounds.at(-1)?.matches ?? [])
                .filter(m => retainedMatch(tournament, p.category, m, retainedTables))
                .map(m => ({ p1: String(m.players[0]), p2: m.players[1] === undefined ? null : String(m.players[1]) }))
            )
        }
      : {}),
    ...(op.op === 'start' ? { rosterOrder: op.observed.rosterOrder.map(String) } : {}),
    ...(['start', 'late-entry'].includes(op.op)
      ? {
          flights: Object.fromEntries(
            op.observed.pods.map(p => [
              categories[p.category],
              p.flights.map(f => ({ number: f.number, playerIds: f.players.map(String) }))
            ])
          )
        }
      : {}),
    ...(atPairing
      ? {
          pairings: Object.fromEntries(
            op.observed.pods.map(p => [
              categories[p.category],
              (p.rounds.at(-1)?.matches ?? []).map(m => ({
                p1: String(m.players[0]),
                p2: m.players[1] === undefined ? null : String(m.players[1])
              }))
            ])
          )
        }
      : {})
  };
}

/** V19-5: only an accepted Swiss repair that leaves a previously eligible active player unseated is partial. */
function partialRepairChoice(t: Tournament, op: FixtureOperation): RecordedChoices['partialRepair'] {
  if (!op.repair || op.expectRejected || (op.pairingResult && op.pairingResult !== 'repaired')) {
    return undefined;
  }
  const entries = op.observed.pods.flatMap(observed => {
    const pod = t.pods.find(p => p.category === categories[observed.category])!;
    if (latestRound(pod)?.kind !== 'swiss') {
      return [];
    }
    const matches = observed.rounds.at(-1)!.matches.map(matchOf);
    const seated = new Set(matches.flatMap(m => [m.p1, m.p2]));
    const missing = activeIds(t, pod).some(id => !seated.has(id) && !pod.repairOmittedPlayers?.includes(id));
    return missing ? [[pod.category, matches]] : [];
  });
  return entries.length ? Object.fromEntries(entries) : undefined;
}

/** V18-2: a pairing whose later attempt succeeds appends its round although it reports none. */
function appendedRound(t: Tournament, op: FixtureOperation): boolean {
  return op.observed.pods.some(
    observed =>
      (observed.rounds.at(-1)?.number ?? 0) >
      (latestRound(t.pods.find(p => p.category === categories[observed.category]))?.number ?? 0)
  );
}

/** Duplicate static tables identify a survivor only together with its unchanged seats. */
function retainedMatch(t: Tournament, category: number, match: FixtureMatch, tables?: number[]): boolean {
  const prior = latestRound(t.pods.find(p => p.category === categories[category])!)?.matches ?? [];
  const sameSeats = prior.some(
    m =>
      m.p1 === String(match.players[0]) && m.p2 === (match.players[1] === undefined ? null : String(match.players[1]))
  );
  return (
    sameSeats &&
    ((match.players.length === 2 && Boolean(tables?.includes(match.table))) || [4, 8].includes(match.outcome))
  );
}

function blockedRanges(op: FixtureOperation): { start: number; end: number }[] {
  if (op.blockedRanges) {
    return op.blockedRanges.split(',').map(range => {
      const [start, end = start] = range.split('-').map(Number) as [number, number?];
      return { start, end };
    });
  }
  return op.blockedTable ? [{ start: op.blockedTable, end: op.blockedTable + 1 }] : [];
}

function resultEntries(op: FixtureOperation, t: Tournament): Match[] {
  const results = op.results!.map(matchOf);
  const pods = t.pods.filter(p => op.pod === undefined || categories[op.pod] === p.category);
  const elimination = pods.every(p => p.rounds.at(-1)?.kind === 'elimination');
  if (!elimination) {
    return results;
  }
  const current = pods.flatMap(p => latestRound(p)?.matches ?? []);
  // V18-8: the attempts follow the saved match list (static seats can take it out of table order): every
  // pending two-seat match, every one with overwrite, and only the match at a given table.
  const matches = results.filter(
    m =>
      m.p2 !== null &&
      (op.table === undefined || m.table === op.table) &&
      (op.overwrite ||
        current.some(
          prior => prior.p1 === m.p1 && prior.p2 === m.p2 && prior.table === m.table && prior.outcome === 'pending'
        ))
  );
  const entered = op.eliminationOutcomes?.split(',').map(code => outcomes[Number(code)]!);
  return matches.map((match, i) => ({ ...match, outcome: entered?.[i % entered.length] ?? match.outcome }));
}

function operationOf(op: FixtureOperation, t: Tournament): LifecycleOperation {
  const pod = op.pod === undefined ? undefined : categories[op.pod];
  const translations: Record<string, () => LifecycleOperation> = {
    'create-event': () => ({
      type: 'create',
      settings: {
        type: op.type as 1 | 2 | 3,
        mode: op.mode as 'CUSTOM' | 'PRERELEASE' | 'LEAGUECHALLENGE' | 'TCG1DAY'
      },
      info: {
        name: op.name ?? "Synthetic & Co's Cup",
        sanctionId: '26-10-000001',
        city: 'Synthetic City',
        state: 'TX',
        country: 'United States',
        organizerPopId: '1234567',
        organizerName: 'Synthetic Organizer',
        startDate: '10/01/2026',
        roundTime: 0,
        finalsRoundTime: 0,
        eventType: op.type === 3 ? 'cup' : 'challenge'
      }
    }),
    'add-players': () => ({
      type: 'register',
      players: op.players!.map(p => ({
        id: String(p.id),
        firstName: p.firstName,
        lastName: p.lastName,
        birthDate: `02/27/${p.birthYear}`,
        byes: p.byes,
        fixedTable: p.staticSeat
      }))
    }),
    configure: () => ({
      type: 'configure',
      eventType: op.type as 1 | 2 | 3,
      cut: op.cut!,
      divisionCuts: Object.fromEntries(
        (op.divisionCuts ?? '')
          .split(',')
          .filter(Boolean)
          .map(entry => {
            const [division, size] = entry.split(':').map(Number);
            return [categories[division!], size];
          })
      ),
      flights: op.flights!,
      lessSwiss: op.lessSwiss!,
      additionalRounds: op.additionalRounds!,
      thirdPlace: op.thirdPlace!,
      manualTables: op.manualTables!,
      blockedRanges: blockedRanges(op),
      overflowTableStart: op.overflowTable,
      wizard: op.wizard,
      roundMinutes: op.roundMinutes ?? 30,
      finalMinutes: op.finalMinutes ?? 75
    }),
    start: () => ({ type: 'start' }),
    pair: () => ({ type: 'pair', pod, repair: op.repair }),
    'probe-pair': () => ({ type: 'pair', pod, repair: op.repair, terminal: true }),
    'view-pairings': () => ({ type: 'viewPairings', pod, step: true }),
    'start-round': () => ({ type: 'startRound', pod }),
    'record-results': () => ({ type: 'results', pod, results: resultEntries(op, t) }),
    'view-records': () => ({ type: 'viewRecords', pod }),
    'view-standings': () => ({ type: 'viewStandings', pod }),
    'play-another-round': () => ({ type: 'playAnotherRound', pod }),
    drop: () => ({
      type: 'drop',
      id: String(op.player),
      disqualified: op.status === 2,
      timestamp: op.timestamp ?? localTime
    }),
    're-enter': () => ({ type: 'reenter', id: String(op.player) }),
    'late-entry': () => ({
      type: 'late',
      player: {
        id: String(op.id),
        firstName: op.firstName ?? 'Synthetic',
        lastName: op.lastName ?? 'Player',
        birthDate: `02/27/${op.birthYear}`
      },
      markLate: op.markLate ?? false,
      forcedLoss: op.forcedLoss ?? false,
      timestamp: op.timestamp ?? localTime
    }),
    'start-top-cut': () => ({ type: 'topCut', pod }),
    'set-flights': () => ({ type: 'setFlights', pod, count: op.flights! }),
    reopen: () => ({ type: 'reopen', pod, table: op.table, player: op.player?.toString(), round: op.round }),
    reload: () => ({ type: 'reload', pod, seconds: op.seconds }),
    'sample-clock': () => ({ type: 'sampleClock', pod, seconds: op.seconds! }),
    finish: () => ({ type: 'finish' }),
    'probe-finish': () => ({ type: 'finish' })
  };
  assert.ok(translations[op.op], `Unknown operation: ${op.op}`);
  return translations[op.op]!();
}

function assertOperationResult(
  scenario: FixtureScenario,
  op: FixtureOperation,
  result: ReturnType<typeof applyLifecycleOperation>,
  prior: Tournament
): void {
  // PAIRING 36: an opening flight of assigned byes saves the started event with an empty round list.
  const assignedStart =
    op.op === 'start' &&
    scenario.operations[0]!.type !== 1 &&
    op.observed.stage === 4 &&
    op.observed.pods.some(p => !p.rounds.length);
  const emptyCut = op.op === 'start-top-cut' && ['top-cut-remaining-0', 'top-cut-remaining-1'].includes(scenario.id);
  const refused =
    op.expectRejected ||
    (op.pairingResult && !['paired', 'repaired'].includes(op.pairingResult)) ||
    (op.finishResult && op.finishResult !== 'saved') ||
    assignedStart ||
    emptyCut;
  if (op.saveResult === 'failed') {
    assert.equal(result.saveFailed, true, 'A terminal pairing error must report its failed save');
    assert.match(result.error!, /save.*could not complete/);
  }
  if (op.finishResult === 'save-stopped-at-standings') {
    assert.match(result.error!, /Standings cannot be saved/);
  }
  const outcome = result.ok ? 'accepted' : `refused (${result.error})`;
  assert.equal(result.ok, !refused, `TOM ${refused ? 'refused' : 'accepted'}; Ciphermaniac ${outcome}`);
  if (!refused) {
    return;
  }
  assert.ok(result.error, 'A refused action needs a clear error');
  if (op.pairingResult === 'bye-exhaustion') {
    assert.match(result.error, /random bye/);
  }
  if (
    op.expectRejected ||
    (op.op === 'probe-pair' &&
      !(op.repair && op.pairingResult === 'pairing-error' && !op.saveResult) &&
      !appendedRound(prior, op))
  ) {
    const persisted =
      ['top-cut-remaining-0', 'top-cut-remaining-1'].includes(scenario.id) && op.op === 'probe-pair'
        ? { ...prior, pods: prior.pods.map(p => ({ ...p, stage: 1 as const })) }
        : prior;
    assert.equal(
      writeTdf(result.tournament, { now: now + 86400000 }),
      writeTdf(persisted, { now: now + 86400000 }),
      'A refused pairing cannot change persisted state'
    );
  }
}

function applyReplayOperation(
  t: Tournament,
  op: FixtureOperation,
  ctx: LifecycleContext
): ReturnType<typeof applyLifecycleOperation> {
  if (op.op === 'probe-finish') {
    const result = applyLifecycleOperation(t, operationOf(op, t), ctx);
    return { ...result, tournament: t };
  }
  if (op.op !== 'record-results' || op.outcomes !== '0') {
    return applyLifecycleOperation(t, operationOf(op, t), ctx);
  }
  let result: ReturnType<typeof applyLifecycleOperation> = { ok: true, tournament: t };
  for (const match of op.results!) {
    result = applyLifecycleOperation(
      result.tournament,
      { type: 'reopen', pod: op.pod === undefined ? undefined : categories[op.pod], player: String(match.players[0]) },
      ctx
    );
    if (!result.ok) {
      return result;
    }
  }
  return result;
}

export interface ReplayDifference {
  step: string;
  expectedLine: string;
  actualLine: string;
  /** Tolerant replays only: the operation, what differed and where. */
  operation?: string;
  kind?: 'checkpoint' | 'result' | 'error';
  path?: string;
  line?: number;
  message?: string;
}

export type ReplayQuestions = Readonly<Record<string, { entry: string; fields: readonly string[] }>>;

export interface ReplayOptions {
  outputDirectory?: string;
  /** Withheld assertions by `scenario/checkpoint`; the suite's own questions by default. */
  questions?: ReplayQuestions;
  /** Record a refused or failed operation and resume from TOM's checkpoint instead of throwing. */
  tolerant?: boolean;
}

const leadingTag = (line: string) => /^\s*<\/?([a-z0-9]+)/i.exec(line)?.[1];

/** The element ancestry of a saved line, such as `tournament/pods/pod/rounds/round`. */
function elementPath(lines: readonly string[], index: number): string {
  const stack: string[] = [];
  for (const line of lines.slice(0, index)) {
    const tag = leadingTag(line);
    if (/^\s*<\//.test(line)) {
      stack.pop();
    } else if (tag && !/\/>\s*$/.test(line) && !line.includes(`</${tag}>`)) {
      stack.push(tag);
    }
  }
  return [...stack, leadingTag(lines[index] ?? '') ?? '<end>'].join('/');
}

function checkpointDifference(step: string, actual: string, expected: string): ReplayDifference {
  const lines = actual.split('\n');
  const expectedLines = expected.split('\n');
  const index = expectedLines.findIndex((line, i) => line !== lines[i]);
  const at = index < 0 ? expectedLines.length : index;
  return {
    step,
    actualLine: lines[at] ?? '<end>',
    expectedLine: expectedLines[at] ?? '<end>',
    line: at + 1,
    path: elementPath(expectedLines[at] === undefined ? lines : expectedLines, at)
  };
}

/**
 * A clock sample's instant: TOM records the shifted start on its own wall clock, so the recorded start
 * plus the sampled seconds is the test time input. Other timestamps keep the fixtures' fixed local time.
 */
function sampledInstant(op: FixtureOperation): number {
  const starts = op.observed.pods
    .filter(p => op.pod === undefined || p.category === op.pod)
    .flatMap(p => p.rounds.at(-1)?.startedAt ?? [])
    .filter(Boolean);
  const [start] = [...new Set(starts)].filter(s => s !== localTime);
  assert.ok(start, `${op.fixture}: a clock sample needs a recorded start`);
  const [, month, day, year, rest] = /^(\d{2})\/(\d{2})\/(\d{4}) (.+)$/.exec(start)!;
  return Date.parse(`${year}-${month}-${day}T${rest}Z`) + op.seconds! * 1000;
}

/**
 * TOM stamps a round started at the fixtures' fixed local time even after a clock sample; only the
 * sampled round's origin moves, and later saves still happen at the sampled instant.
 */
function replayContext(
  op: FixtureOperation,
  saved: number,
  random: () => number,
  reopened: boolean,
  tournament: Tournament
): LifecycleContext {
  const clock = op.op === 'start-round' ? now : saved;
  const sampleTime = op.op === 'sample-clock' ? new Date(clock).toISOString() : undefined;
  return {
    now: clock,
    localTime: sampleTime
      ? sampleTime.replace(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2}:\d{2}).*$/, '$2/$3/$1 $4')
      : localTime,
    season: 2027,
    random,
    recorded: choices(op, reopened, tournament)
  };
}

interface ReplayState {
  tournament: Tournament;
  sampled?: number;
  roundSamples: Map<string, number>;
  reopened: boolean;
  /** Pods whose Swiss search ran since the file was last opened (V20-1). */
  searched: Set<PodCategory>;
  /** The rounds the file held when it was last opened (V22-5). */
  read: Set<string>;
}

/** V22-5: holders of a random bye from a Swiss round paired since the file was last opened. */
function freshRandomByes(t: Tournament, read: ReadonlySet<string>): string[] {
  return t.pods.flatMap(pod =>
    pod.rounds
      .filter(r => r.kind === 'swiss' && !read.has(`${pod.category}:${r.number}`))
      .flatMap(r => r.matches.filter(m => m.outcome === 'bye').map(m => m.p1))
  );
}

const SEARCHES = new Set(['start', 'pair', 'probe-pair', 'play-another-round']);

function trackSearches(op: FixtureOperation, state: ReplayState): void {
  if (op.op === 'reload') {
    state.searched.clear();
    state.read = new Set(state.tournament.pods.flatMap(p => p.rounds.map(r => `${p.category}:${r.number}`)));
  } else if (SEARCHES.has(op.op)) {
    const pods = state.tournament.pods.filter(p => op.pod === undefined || categories[op.pod] === p.category);
    pods.forEach(p => state.searched.add(p.category));
  }
}

/** V16-1: start timestamps follow the recorded wall clock; elapsed samples remain replay inputs. */
function sampledClocks(scenario: FixtureScenario, op: FixtureOperation, state: ReplayState): Tournament {
  const saved = state.sampled ?? now + 86400000;
  const legacy = /^b[xy]1-/.test(scenario.id);
  return {
    ...state.tournament,
    pods: state.tournament.pods.map(pod => ({
      ...pod,
      rounds: pod.rounds.map(round => {
        const seconds = state.roundSamples.get(`${pod.category}:${round.number}`);
        const recorded = op.observed.pods
          .find(p => categories[p.category] === pod.category)
          ?.rounds.find(r => r.number === round.number);
        if (seconds === undefined || !recorded?.startedAt) {
          return round;
        }
        const elapsed = legacy ? fullRoundSeconds(state.tournament, round.kind) - recorded.timeLeft : seconds;
        return {
          ...round,
          startTime: recorded.startedAt,
          startedAt: saved - elapsed * 1000,
          ...(typeof round.clockStartedAt === 'number' ? { clockStartedAt: saved - elapsed * 1000 } : {})
        };
      })
    }))
  };
}

function savedCheckpoint(scenario: FixtureScenario, op: FixtureOperation, state: ReplayState, options: ReplayOptions) {
  const actual = writeTdf(state.tournament, { now: state.sampled ?? now + 24 * 60 * 60 * 1000 });
  if (options.outputDirectory) {
    const directory = join(options.outputDirectory, scenario.id);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, op.fixture), actual);
  }
  const expectedBytes = fixtureBytes(scenario, op);
  const expected = expectedBytes.toString('utf8');
  assert.deepEqual(Buffer.from(expected), expectedBytes, 'Fixtures must be valid UTF-8');
  return { actual, expected };
}

/** Corpus defects whose checkpoint also holds the partial result of an unrecorded aborted repair. */
const UNRECORDED_ABORTED_REPAIRS = new Set([
  'bx2-flights-11039/0012-view-pairings.tdf',
  'bx3-flights-31598/0012-view-pairings.tdf',
  'bx3-flights-31680/0035-view-pairings.tdf',
  'bx3-flights-32077/0011-view-pairings.tdf',
  'bx3-flights-32604/0009-start-round.tdf'
]);

/** V18-10: only the random opening draw's surviving seat order is read after a playoff abort. */
function abortedOpeningOrder(scenario: FixtureScenario, op: FixtureOperation, t: Tournament): string[] | undefined {
  if (t.settings?.type !== 1 || !op.repair || op.pairingResult !== 'pairing-error' || op.saveResult) {
    return undefined;
  }
  const pod = t.pods.find(p => op.pod === undefined || p.category === categories[op.pod]);
  if (!pod || pod.rounds.length !== 1) {
    return undefined;
  }
  const survivors = new Set(survivorList(t, pod));
  const saved = parseTdf(fixtureBytes(scenario, op).toString('utf8'));
  const order = saved.players.filter(p => survivors.has(p.id)).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  // An abort before the draw leaves the old positions; it supplied no new choice.
  return order.every((p, i) => p.order === i + 1) ? order.map(p => p.id) : undefined;
}

/**
 * SPEC V24-5: the checkpoint's finished standings are the recorded choice for a group the third-place setting
 * comparison cannot order. V25-2 also uses this choice for affected equal-win groups after a repair and before
 * a reading; a finish attempt whose save stopped at the standings recorded none.
 */
function savedFinishedOrder(scenario: FixtureScenario, op: FixtureOperation): RecordedChoices['thirdPlaceOrder'] {
  if (op.finishResult === 'save-stopped-at-standings') {
    return undefined;
  }
  const saved = fixtureBytes(scenario, op).toString('utf8');
  const standings = /<standings>([\s\S]*?)<\/standings>/.exec(saved)?.[1] ?? '';
  return [...standings.matchAll(/<pod category="(\d+)" type="finished">([\s\S]*?)<\/pod>/g)].map(([, code, body]) => ({
    category: categories[Number(code)]!,
    playerIds: [...body!.matchAll(/<player id="([^"]+)"/g)].map(([, id]) => id!)
  }));
}

/** PAIRING V24-7: a return's saved round, the choice of whether it appended an abandoned search's match. */
function savedReturnMatch(op: FixtureOperation, t: Tournament): RecordedChoices['returnMatch'] {
  const pod = t.pods.find(p => p.playerIds.includes(String(op.player)));
  const saved = op.op === 're-enter' && pod && op.observed.pods.find(p => categories[p.category] === pod.category);
  const matches = saved ? (saved.rounds.at(-1)?.matches ?? []) : [];
  const last = matches.at(-1);
  return last ? { matches: matches.length, match: matchOf(last) } : undefined;
}

/** SPEC V24-9: a cut start's checkpoint records its seeds, the choice for a head-to-head cycle at its selection. */
function savedCutSeeds(scenario: FixtureScenario, op: FixtureOperation): string[] | undefined {
  if (!['start-top-cut', 'pair', 'probe-pair'].includes(op.op)) {
    return undefined;
  }
  const saved = parseTdf(fixtureBytes(scenario, op).toString('utf8'));
  return saved.players
    .filter(p => (p.seed ?? 0) > 0)
    .sort((a, b) => a.seed! - b.seed!)
    .map(p => p.id);
}

/** Apply one operation and compare its checkpoint; a tolerant replay records failures and resumes from TOM's save. */
function replayOperation(
  scenario: FixtureScenario,
  op: FixtureOperation,
  state: ReplayState,
  random: () => number,
  options: ReplayOptions
): ReplayDifference | undefined {
  const key = `${scenario.id}/${op.fixture}`;
  const question = (options.questions ?? REPLAY_QUESTIONS)[key];
  if (question?.fields.length === 0) {
    state.tournament = questionSuffix(state.tournament, fixtureBytes(scenario, op).toString('utf8'));
    return undefined;
  }
  // PAIRING V17-6, V18-4: the generator omitted aborted repairs before these operations.
  if (UNRECORDED_ABORTED_REPAIRS.has(key)) {
    const abortedRepair = Object.fromEntries(
      op.observed.pods.map(p => [categories[p.category], p.rounds.at(-1)!.matches.map(matchOf)])
    );
    state.tournament = applyLifecycleOperation(
      state.tournament,
      { type: 'pair', repair: true, terminal: true },
      {
        now,
        localTime,
        season: 2027,
        random,
        recorded: { abortedRepair }
      }
    ).tournament;
  }
  const prior = state.tournament;
  try {
    const context = replayContext(op, state.sampled ?? now, random, state.reopened, prior);
    const abortedBracketOrder = abortedOpeningOrder(scenario, op, prior);
    context.recorded = {
      ...context.recorded,
      abortedBracketOrder,
      keptDepartureMatch: keptDepartureMatch(op, prior, state.searched),
      freshRandomByes: freshRandomByes(prior, state.read),
      thirdPlaceOrder: savedFinishedOrder(scenario, op),
      cutSeeds: savedCutSeeds(scenario, op),
      returnMatch: savedReturnMatch(op, prior)
    };
    const result = applyReplayOperation(prior, op, context);
    assertOperationResult(scenario, op, result, prior);
    state.tournament = sampledClocks(scenario, op, { ...state, tournament: result.tournament });
  } catch (error) {
    if (!options.tolerant) {
      throw error;
    }
    state.tournament = questionSuffix(prior, fixtureBytes(scenario, op).toString('utf8'));
    const message = error instanceof Error ? error.message : String(error);
    const kind = error instanceof assert.AssertionError ? 'result' : 'error';
    return { step: key, operation: op.op, kind, message, expectedLine: '', actualLine: '' };
  }
  const { actual, expected } = savedCheckpoint(scenario, op, state, options);
  const fields = question?.fields ?? [];
  const differs = answeredCheckpoint(actual, fields) !== answeredCheckpoint(expected, fields);
  if (question || (differs && options.tolerant)) {
    state.tournament = questionSuffix(state.tournament, expected);
  }
  if (!differs) {
    return undefined;
  }
  const difference = checkpointDifference(key, actual, expected);
  return options.tolerant ? { ...difference, operation: op.op, kind: 'checkpoint' } : difference;
}

export function replayScenario(scenario: FixtureScenario, options: ReplayOptions = {}): ReplayDifference[] {
  const state: ReplayState = {
    tournament: emptyTournament({ name: 'Replay' }),
    reopened: false,
    roundSamples: new Map(),
    searched: new Set(),
    read: new Set()
  };
  const differences: ReplayDifference[] = [];
  const random = seededRandom(1);
  for (const op of scenario.operations) {
    // Checkpoints save with an expired round clock until a clock sample supplies the save time.
    state.sampled = op.op === 'sample-clock' ? sampledInstant(op) : state.sampled;
    if (op.op === 'sample-clock') {
      for (const pod of op.observed.pods.filter(p => op.pod === undefined || p.category === op.pod)) {
        const round = pod.rounds.at(-1);
        if (round?.startedAt) {
          state.roundSamples.set(`${categories[pod.category]}:${round.number}`, op.seconds!);
        }
      }
    }
    state.reopened ||= op.op === 'reload';
    const difference = replayOperation(scenario, op, state, random, options);
    trackSearches(op, state);
    if (difference) {
      differences.push(difference);
    }
  }
  return differences;
}
