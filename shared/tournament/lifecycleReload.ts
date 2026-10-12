import { divisionLookup } from './divisions.js';
import { lifecycleDocument } from './lifecycleImport.js';
import { keepsSurvivors, rebuiltSurvivors } from './lifecycleSurvivors.js';
import type { LifecycleContext, LifecycleOperation } from './lifecycleTypes.js';
import { divisionsOf } from './podding.js';
import { fullRoundSeconds, latestRound, roundComplete, schedulePlayers } from './rounds.js';
import { parseTdf, writeTdf } from './tdf.js';
import type { Match, Pod, Round, Tournament } from './types.js';

/** Explicit TOM reopening resets tie preferences and completed round stages. */
export function reloadEvent(
  t: Tournament,
  ctx: LifecycleContext,
  operation?: Extract<LifecycleOperation, { type: 'reload' }>
): Tournament {
  const origins = new Map(
    t.pods.flatMap(pod => pod.rounds.map(round => [`${pod.category}:${round.number}`, round.startedAt] as const))
  );
  const input = parseTdf(writeTdf(t, { now: ctx.now }));
  if (operation?.seconds !== undefined) {
    input.pods = input.pods.map(pod =>
      operation.pod === undefined || operation.pod === pod.category
        ? {
            ...pod,
            rounds: pod.rounds.map(round =>
              round === latestRound(pod) ? { ...round, timeLeft: operation.seconds! } : round
            )
          }
        : pod
    );
  }
  const reopened = lifecycleDocument(input);
  if (reopened.passthrough) {
    delete reopened.passthrough.standings;
  }
  const { settings } = reopened;
  return schedulePlayers({
    ...reopened,
    headToHeadOrder: t.headToHeadOrder,
    settings: settings && {
      ...settings,
      overflowTableStart: reopenedOverflowStart(reopened, settings.overflowTableStart)
    },
    // Equal names follow the roster order of the reopened file, also after a later start reorders it (SPEC 3.7).
    players: reopened.players.map((player, i) => ({ ...player, tiebreaker: i + 1, disqualifiedOrder: i + 1 })),
    pods: reopened.pods.map(pod => reopenedPod(reopened, pod, origins))
  });
}

function departedWin(t: Tournament, match: Match): boolean {
  const winner = match.outcome === 'p1' ? match.p1 : match.outcome === 'p2' ? match.p2 : null;
  return match.p2 !== null && winner !== null && t.players.some(p => p.id === winner && p.droppedAfter !== null);
}

function reopenedOrigin(
  pod: Pod,
  round: Round,
  origins: ReadonlyMap<string, number | undefined>
): Pick<Round, 'startedAt'> {
  return round.startTime
    ? {
        startedAt:
          origins.get(`${pod.category}:${round.number}`) ??
          Date.parse(round.startTime.replace(/^(\d{2})\/(\d{2})\/(\d{4}) /, '$3-$1-$2T'))
      }
    : {};
}

/**
 * SPEC 3.6: reading returns a round saved at 5 or later to 4, and the latest complete round to 5. A round without
 * matches (V22-3) and a round of restored departed wins (V14a) keep their saved stage.
 */
function reopenedStage(pod: Pod, round: Round, matches: readonly Match[], allRestored: boolean): number {
  const saved = round.stage ?? 2;
  const read = allRestored || !round.matches.length ? saved : Math.min(saved, 4);
  return read === 4 && round === latestRound(pod) && roundComplete({ ...round, matches: [...matches] }) ? 5 : read;
}

function reopenedRound(t: Tournament, pod: Pod, round: Round, origins: ReadonlyMap<string, number | undefined>): Round {
  const restored = round.kind === 'elimination' && round.matches.some(m => departedWin(t, m));
  const allRestored = restored && round.matches.every(m => departedWin(t, m));
  const matches = round.matches.map(m =>
    round.kind === 'elimination' && departedWin(t, m) ? { ...m, outcome: 'pending' as const } : m
  );
  const stage = reopenedStage(pod, round, matches, allRestored);
  return {
    ...round,
    matches,
    // An unstarted round saves its full length whatever time the opened file held.
    ...(round.startTime ? {} : { timeLeft: fullRoundSeconds(t, round.kind) }),
    ...reopenedOrigin(pod, round, origins),
    stage,
    status: stage >= 5 ? 'finished' : stage >= 4 ? 'started' : round.status
  };
}

/** V18-8: reopening rebuilds the surviving players from the restored rounds. */
function reopenedPod(t: Tournament, pod: Pod, origins: ReadonlyMap<string, number | undefined>): Pod {
  const { survivors: _kept, survivorsUnconfirmed: _held, ...rest } = pod;
  const reopened: Pod = {
    ...rest,
    ...(pod.divisionCounts ? { divisionCounts: reopenedCounts(t, pod, pod.divisionCounts) } : {}),
    rounds: pod.rounds.map(round => reopenedRound(t, pod, round, origins))
  };
  if (!keepsSurvivors(t, reopened)) {
    return reopened;
  }
  const survivors = rebuiltSurvivors(t, reopened);
  return t.settings?.type === 1 ? { ...reopened, survivors } : { ...reopened, survivors, survivorsUnconfirmed: true };
}

/** A division saved with no players at the start is counted again from its registered roster. */
function reopenedCounts(t: Tournament, pod: Pod, counts: NonNullable<Pod['divisionCounts']>): Pod['divisionCounts'] {
  const of = divisionLookup(t);
  return Object.fromEntries(
    Object.entries(counts).map(([division, count]) => [
      division,
      count || pod.playerIds.filter(id => of(id) === division).length
    ])
  );
}

/** SPEC 3.2: nine above each saved pod start plus half its whole registered roster, ignoring occupied tables. */
function reopenedOverflowStart(t: Tournament, saved: number): number {
  if (t.pods.length === 0) {
    return saved;
  }
  const of = divisionLookup(t);
  const allowance = Math.max(
    0,
    ...t.pods.map(pod => {
      const divisions = divisionsOf(pod.category);
      const registered = t.players.filter(player => divisions.includes(of(player.id))).length;
      return pod.startingTable + Math.floor(registered / 2);
    })
  );
  return Math.max(saved, allowance + 9);
}
