import { divisionLookup } from './divisions.js';
import type { LifecycleContext } from './lifecycleTypes.js';
import { activeIds, latestRound, pointsBefore } from './rounds.js';
import { swissStandings } from './standings.js';
import { DIVISIONS, type Match, type Pod, type Tournament } from './types.js';

interface RepairField {
  points: ReadonlyMap<string, number>;
  division: (id: string) => number;
  pool: Set<string>;
  survivors: Set<Match>;
  ctx: LifecycleContext;
}

const seats = (match: Match): string[] => (match.p2 === null ? [match.p1] : [match.p1, match.p2]);
/** An unstarted round's forced loss is a repair candidate like a two-seat match. */
const forcedLoss = (match: Match): boolean => match.outcome === 'loss' && match.p2 === null;

function mixedTotals(match: Match, field: RepairField): boolean {
  return match.p2 !== null && field.points.get(match.p1) !== field.points.get(match.p2);
}

function candidate(field: RepairField, points: number, division: number): Match | undefined {
  // V18-3: a decided two-seat match is a candidate for its players' totals with that result.
  const eligible = [...field.survivors].filter(
    m =>
      (m.p2 !== null || m.outcome === 'assigned-bye' || forcedLoss(m)) &&
      seats(m).some(id => (field.points.get(id) ?? 0) === points && field.division(id) <= division)
  );
  const exact = eligible.filter(m =>
    seats(m).some(id => (field.points.get(id) ?? 0) === points && field.division(id) === division)
  );
  const matches = exact.length ? exact : eligible;
  const preferred = matches.filter(m => mixedTotals(m, field));
  const choices = preferred.length ? preferred : matches;
  return choices.length ? choices[Math.floor(field.ctx.random() * choices.length)] : undefined;
}

function dissolveAt(field: RepairField, points: number, division: number): void {
  const match = candidate(field, points, division);
  if (!match) {
    return;
  }
  const count = [...field.pool].filter(
    id => (field.points.get(id) ?? 0) === points && field.division(id) === division
  ).length;
  const divisions = new Set(seats(match).map(field.division));
  if (count < 3 || mixedTotals(match, field) || divisions.size > 1) {
    field.survivors.delete(match);
    seats(match).forEach(id => field.pool.add(id));
  }
}

function dissolveFor(field: RepairField, id: string): void {
  for (let points = field.points.get(id) ?? 0; points >= 0; points -= 1) {
    for (let division = field.division(id); division >= 0; division -= 1) {
      dissolveAt(field, points, division);
    }
  }
}

function generatedSurvivors(t: Tournament, pod: Pod, ctx: LifecycleContext): Set<Match> {
  const round = latestRound(pod)!;
  const points = pointsBefore(pod, round.number + Number(Boolean(ctx.terminalPairing)));
  if (!ctx.terminalPairing) {
    for (const match of round.matches.filter(m => m.outcome === 'assigned-bye')) {
      points.set(match.p1, (points.get(match.p1) ?? 0) + 3);
    }
  }
  const of = divisionLookup(t);
  const division = (id: string) => DIVISIONS.indexOf(of(id));
  const active = new Set(activeIds(t, pod));
  const retained = new Set(round.matches.filter(m => forcedLoss(m) || m.outcome === 'assigned-bye' || m.p2 !== null));
  const seated = new Set([...retained].flatMap(seats));
  const unpaired = swissStandings(pod, t.players, { throughRound: round.number - 1 }).filter(
    row => active.has(row.playerId) && !seated.has(row.playerId)
  );
  for (const flight of pod.flights ?? [{ number: 1, playerIds: pod.playerIds }]) {
    const candidates = (m: Match) =>
      flight.playerIds.includes(m.p1) && (m.p2 !== null || m.outcome === 'assigned-bye' || forcedLoss(m));
    const survivors = new Set([...retained].filter(candidates));
    const pool = new Set(unpaired.filter(row => flight.playerIds.includes(row.playerId)).map(row => row.playerId));
    const field: RepairField = { points, division, survivors, pool, ctx };
    [...pool].forEach(id => dissolveFor(field, id));
    for (const match of retained) {
      if (candidates(match) && !survivors.has(match)) {
        retained.delete(match);
      }
    }
  }
  return retained;
}

/** Survivor selection is a recorded random choice, not an expected table assignment. */
export function repairSurvivors(t: Tournament, pod: Pod, ctx: LifecycleContext): Match[] {
  const round = latestRound(pod)!;
  const recorded = ctx.recorded?.retainedTables;
  if (recorded === undefined) {
    const survivors = generatedSurvivors(t, pod, ctx);
    return round.matches.filter(m => survivors.has(m));
  }
  const seats = ctx.recorded?.retainedPairings?.filter(pair => pod.playerIds.includes(pair.p1));
  if (seats) {
    const matches = round.matches.filter(m => seats.some(p => p.p1 === m.p1 && p.p2 === m.p2));
    if (seats.some(p => !matches.some(m => m.p1 === p.p1 && m.p2 === p.p2))) {
      throw new Error('A recorded survivor must retain an existing two-seat match');
    }
    return matches;
  }
  const retained = new Set(recorded);
  const matches = round.matches.filter(m => forcedLoss(m) || (m.p2 !== null && retained.has(m.table)));
  if (recorded.some(table => !matches.some(m => m.p2 !== null && m.table === table))) {
    throw new Error('A recorded survivor must retain an existing two-seat match');
  }
  return matches;
}
