import type { Match, NormalizedEvent } from '../contracts';
import { archetypeKey } from '../archetypes/identity';

export const PHASE_MULTIPLIERS: Readonly<Record<number, number>> = { 1: 1, 2: 1.75, 3: 3 };
export const QUALITY_MODEL = {
  description: 'tierBase + placementPercentileWeight * placementPercentile, scaled by phase multiplier',
  tierBase: { topcut: 1, phase2: 0.7, other: 0.4 },
  placementPercentileWeight: 0.3
} as const;

const COUNTED_OUTCOMES = new Set(['decided', 'tie', 'double_loss']);
type SideResult = 'win' | 'loss' | 'tie' | 'double_loss';
export type MatchupWeighting = 'all' | 'qualityWeighted';

export interface MatchupPairRow {
  archetypeA: string;
  archetypeB: string;
  matches: number;
  weightedMatches: number;
  winsA: number;
  winsB: number;
  ties: number;
  doubleLosses: number;
  weightedWinsA: number;
  weightedWinsB: number;
  weightedTies: number;
  weightedWinRateA: number;
  weightedWinRateB: number;
}

export interface MatchupArchetypeRow {
  archetype: string;
  matches: number;
  weightedMatches: number;
  weightedWins: number;
  weightedLosses: number;
  weightedTies: number;
  weightedWinRate: number;
}

export interface MatchupProfile {
  name: MatchupWeighting;
  matchesConsidered: number;
  weightedMatches: number;
  byArchetypePair: MatchupPairRow[];
  byArchetype: MatchupArchetypeRow[];
}

export interface MatchupProfilesBody {
  phaseMultipliers: Record<string, number>;
  qualityModel: typeof QUALITY_MODEL;
  profiles: Record<MatchupWeighting, MatchupProfile>;
}

interface Pilot {
  archetype: string;
  quality: number;
}
interface Results {
  first: SideResult;
  second: SideResult;
}
interface ProfileState {
  profile: MatchupProfile;
  pairs: Map<string, MatchupPairRow>;
  archetypes: Map<string, MatchupArchetypeRow>;
}
interface MatchContext {
  match: Match;
  first: Pilot;
  second: Pilot;
  results: Results;
  labels: ReadonlyMap<string, string>;
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function playerQuality(madePhase2: boolean, madeTopCut: boolean, placement: number | null, players: number): number {
  const tier = madeTopCut
    ? QUALITY_MODEL.tierBase.topcut
    : madePhase2
      ? QUALITY_MODEL.tierBase.phase2
      : QUALITY_MODEL.tierBase.other;
  const percentile =
    placement !== null && Number.isInteger(placement) && players > 0
      ? Math.max(0, Math.min(1, (players - placement + 1) / players))
      : 0;
  return tier + QUALITY_MODEL.placementPercentileWeight * percentile;
}

function buildPilots(event: NormalizedEvent): { pilots: Map<string, Pilot>; labels: Map<string, string> } {
  const players = event.meta.playerCount > 0 ? event.meta.playerCount : event.participants.length;
  const keys = new Map<string, string>();
  const labels = new Map<string, string>();
  for (const deck of event.decks) {
    const label = deck.archetype.displayName.trim();
    const key = label ? archetypeKey(label) : 'unknown';
    keys.set(deck.participantId, key);
    if (key !== 'unknown' && (labels.get(key) === undefined || label < labels.get(key)!)) {
      labels.set(key, label);
    }
  }
  const pilots = new Map<string, Pilot>();
  for (const participant of event.participants) {
    pilots.set(participant.participantId, {
      archetype: keys.get(participant.participantId) ?? 'unknown',
      quality: playerQuality(participant.flags.madePhase2, participant.flags.madeTopCut, participant.placement, players)
    });
  }
  return { pilots, labels };
}

function emptyProfile(name: MatchupWeighting): ProfileState {
  return {
    profile: { name, matchesConsidered: 0, weightedMatches: 0, byArchetypePair: [], byArchetype: [] },
    pairs: new Map(),
    archetypes: new Map()
  };
}

function resultsFor(match: Match): Results {
  if (match.outcome === 'tie') {
    return { first: 'tie', second: 'tie' };
  }
  if (match.outcome === 'double_loss') {
    return { first: 'double_loss', second: 'double_loss' };
  }
  const firstWon = match.winnerParticipantId === match.participantIds[0];
  return firstWon ? { first: 'win', second: 'loss' } : { first: 'loss', second: 'win' };
}

function pairRow(archetypeA: string, archetypeB: string): MatchupPairRow {
  return {
    archetypeA,
    archetypeB,
    matches: 0,
    weightedMatches: 0,
    winsA: 0,
    winsB: 0,
    ties: 0,
    doubleLosses: 0,
    weightedWinsA: 0,
    weightedWinsB: 0,
    weightedTies: 0,
    weightedWinRateA: 0,
    weightedWinRateB: 0
  };
}

function archetypeRow(archetype: string): MatchupArchetypeRow {
  return {
    archetype,
    matches: 0,
    weightedMatches: 0,
    weightedWins: 0,
    weightedLosses: 0,
    weightedTies: 0,
    weightedWinRate: 0
  };
}

function addArchetype(
  state: ProfileState,
  side: { key: string; label: string; result: SideResult },
  weight: number
): void {
  const { key, label, result } = side;
  if (result === 'double_loss') {
    return;
  }
  const row = state.archetypes.get(key) ?? archetypeRow(label);
  state.archetypes.set(key, row);
  row.matches += 1;
  row.weightedMatches += weight;
  if (result === 'win') {
    row.weightedWins += weight;
  }
  if (result === 'loss') {
    row.weightedLosses += weight;
  }
  if (result === 'tie') {
    row.weightedTies += weight;
  }
}

function addPairResult(
  pair: MatchupPairRow,
  outcome: Match['outcome'],
  leftResult: SideResult,
  weight: number
): MatchupPairRow {
  const next = { ...pair, matches: pair.matches + 1, weightedMatches: pair.weightedMatches + weight };
  if (outcome === 'tie') {
    return {
      ...next,
      ties: pair.ties + 1,
      winsA: pair.winsA + 0.5,
      winsB: pair.winsB + 0.5,
      weightedWinsA: pair.weightedWinsA + 0.5 * weight,
      weightedWinsB: pair.weightedWinsB + 0.5 * weight,
      weightedTies: pair.weightedTies + weight
    };
  }
  if (outcome === 'double_loss') {
    return { ...next, doubleLosses: pair.doubleLosses + 1 };
  }
  if (leftResult === 'win') {
    return { ...next, winsA: pair.winsA + 1, weightedWinsA: pair.weightedWinsA + weight };
  }
  return { ...next, winsB: pair.winsB + 1, weightedWinsB: pair.weightedWinsB + weight };
}

function accumulate(state: ProfileState, context: MatchContext, weight: number): void {
  const { match, first, second, results, labels } = context;
  state.profile.matchesConsidered += 1;
  state.profile.weightedMatches += weight;
  const [left, right] =
    first.archetype <= second.archetype ? [first.archetype, second.archetype] : [second.archetype, first.archetype];
  const leftResult = first.archetype === left ? results.first : results.second;
  const key = `${left}||${right}`;
  const pair = state.pairs.get(key) ?? pairRow(labels.get(left) ?? 'Unknown', labels.get(right) ?? 'Unknown');
  state.pairs.set(key, addPairResult(pair, match.outcome, leftResult, weight));
  addArchetype(
    state,
    { key: first.archetype, label: labels.get(first.archetype) ?? 'Unknown', result: results.first },
    weight
  );
  addArchetype(
    state,
    { key: second.archetype, label: labels.get(second.archetype) ?? 'Unknown', result: results.second },
    weight
  );
}

function pairOutput(pair: MatchupPairRow): MatchupPairRow {
  const weightedMatches = round(pair.weightedMatches, 6);
  const weightedWinsA = round(pair.weightedWinsA, 6);
  const weightedWinsB = round(pair.weightedWinsB, 6);
  return {
    ...pair,
    weightedMatches,
    weightedWinsA,
    weightedWinsB,
    weightedTies: round(pair.weightedTies, 6),
    weightedWinRateA: weightedMatches > 0 ? round((weightedWinsA / weightedMatches) * 100, 3) : 0,
    weightedWinRateB: weightedMatches > 0 ? round((weightedWinsB / weightedMatches) * 100, 3) : 0
  };
}

function archetypeOutput(row: MatchupArchetypeRow): MatchupArchetypeRow {
  const weightedMatches = round(row.weightedMatches, 6);
  const weightedWins = round(row.weightedWins, 6);
  return {
    ...row,
    weightedMatches,
    weightedWins,
    weightedLosses: round(row.weightedLosses, 6),
    weightedTies: round(row.weightedTies, 6),
    weightedWinRate: weightedMatches > 0 ? round((weightedWins / weightedMatches) * 100, 3) : 0
  };
}

function finalize(state: ProfileState): MatchupProfile {
  const byArchetypePair = [...state.pairs.values()]
    .map(pairOutput)
    .sort(
      (a, b) =>
        b.weightedMatches - a.weightedMatches ||
        compareText(a.archetypeA, b.archetypeA) ||
        compareText(a.archetypeB, b.archetypeB)
    );
  const byArchetype = [...state.archetypes.values()]
    .map(archetypeOutput)
    .sort((a, b) => b.weightedMatches - a.weightedMatches || compareText(a.archetype, b.archetype));
  return { ...state.profile, weightedMatches: round(state.profile.weightedMatches, 6), byArchetypePair, byArchetype };
}

function matchContext(
  match: Match,
  pilots: ReadonlyMap<string, Pilot>,
  labels: ReadonlyMap<string, string>
): MatchContext | null {
  if (match.participantIds.length !== 2 || !COUNTED_OUTCOMES.has(match.outcome)) {
    return null;
  }
  const first = pilots.get(match.participantIds[0]);
  const second = pilots.get(match.participantIds[1]);
  if (!first || !second || first.archetype === 'unknown' || second.archetype === 'unknown') {
    return null;
  }
  return { match, first, second, results: resultsFor(match), labels };
}

export function buildMatchupProfiles(event: NormalizedEvent): MatchupProfilesBody {
  const { pilots, labels } = buildPilots(event);
  const states = { all: emptyProfile('all'), qualityWeighted: emptyProfile('qualityWeighted') };
  for (const match of event.matches) {
    const context = matchContext(match, pilots, labels);
    if (!context) {
      continue;
    }
    accumulate(states.all, context, 1);
    const phase = PHASE_MULTIPLIERS[match.phase ?? 1] ?? 1;
    accumulate(states.qualityWeighted, context, (phase * (context.first.quality + context.second.quality)) / 2);
  }
  return {
    phaseMultipliers: Object.fromEntries(Object.entries(PHASE_MULTIPLIERS)),
    qualityModel: QUALITY_MODEL,
    profiles: { all: finalize(states.all), qualityWeighted: finalize(states.qualityWeighted) }
  };
}
