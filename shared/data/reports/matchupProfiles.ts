/**
 * Matchup-profile serving builder (`matchupProfiles.json`).
 *
 * Aggregates archetype-vs-archetype records for one event under two weighting
 * profiles — `all` (every counted match weighted 1) and `qualityWeighted` (each
 * match weighted by phase importance × average player quality). Consumed by the
 * matchups panel and archetype win-rate views, which read `qualityWeighted` with
 * a fallback to `all`.
 *
 * This ports `aggregate_matchups`/`calculate_player_quality` from
 * `.github/scripts/download-tournament.py`, building from the NORMALIZED event
 * (participants + decks + matches) instead of raw Limitless rows. The quality
 * model is versioned policy: tier base (topcut 1.0 / day2 0.7 / other 0.4) plus
 * a placement-percentile bonus, times the phase multiplier.
 *
 * The volatile `generatedAt` and the event `tournament` header are added by the
 * publishing layer; this builder returns only the deterministic body.
 * @module shared/data/reports/matchupProfiles
 */

import type { NormalizedEvent } from '../contracts';
import { archetypeKey } from '../archetypes/identity';

/** Phase importance multipliers (Swiss 1.0, Day 2 1.75, top cut 3.0). */
export const PHASE_MULTIPLIERS: Readonly<Record<number, number>> = { 1: 1.0, 2: 1.75, 3: 3.0 };

/** Versioned player-quality model, surfaced in the artifact for provenance. */
export const QUALITY_MODEL = {
  description: 'tierBase + placementPercentileWeight * placementPercentile, scaled by phase multiplier',
  tierBase: { topcut: 1.0, phase2: 0.7, other: 0.4 },
  placementPercentileWeight: 0.3
} as const;

const COUNTED_OUTCOMES: ReadonlySet<string> = new Set(['decided', 'tie', 'double_loss']);

export type MatchupWeighting = 'all' | 'qualityWeighted';

/** One archetype-vs-archetype cell (labels sorted, so `A` <= `B`). */
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

/** Per-archetype rollup across all its pairs. */
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

/** Round to `places` decimals (half-up, deterministic). */
function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

interface Pilot {
  archetype: string;
  quality: number;
}

function playerQuality(madePhase2: boolean, madeTopCut: boolean, placement: number | null, players: number): number {
  const tierBase = madeTopCut ? QUALITY_MODEL.tierBase.topcut : madePhase2 ? QUALITY_MODEL.tierBase.phase2 : QUALITY_MODEL.tierBase.other;
  let percentile = 0;
  if (placement !== null && Number.isInteger(placement) && players > 0) {
    percentile = Math.max(0, Math.min(1, (players - placement + 1) / players));
  }
  return tierBase + QUALITY_MODEL.placementPercentileWeight * percentile;
}

/**
 * Build the deterministic matchup-profile body for an event.
 * @param event - Normalized event
 * @returns The profile body (phaseMultipliers, qualityModel, profiles)
 */
export function buildMatchupProfiles(event: NormalizedEvent): MatchupProfilesBody {
  const players = event.meta.playerCount > 0 ? event.meta.playerCount : event.participants.length;

  // Group by the archetype comparison KEY so casing/punctuation variants of one
  // archetype (e.g. a mirror match) collapse instead of splitting (D3). Each key
  // gets one canonical display label — the lexicographically smallest displayName
  // among its decks — matching the determinism rule used by the archetype build.
  const keyByParticipant = new Map<string, string>();
  const labelByKey = new Map<string, string>();
  for (const deck of event.decks) {
    const display = (deck.archetype.displayName || '').trim();
    const key = display ? archetypeKey(display) : '';
    keyByParticipant.set(deck.participantId, key || 'unknown');
    if (key) {
      const existing = labelByKey.get(key);
      if (existing === undefined || display < existing) labelByKey.set(key, display);
    }
  }
  const labelFor = (key: string): string => labelByKey.get(key) ?? 'Unknown';

  const pilotByParticipant = new Map<string, Pilot>();
  for (const participant of event.participants) {
    pilotByParticipant.set(participant.participantId, {
      archetype: keyByParticipant.get(participant.participantId) ?? 'unknown',
      quality: playerQuality(
        participant.flags.madePhase2 === true,
        participant.flags.madeTopCut === true,
        participant.placement ?? null,
        players
      )
    });
  }

  const profiles: Record<MatchupWeighting, MatchupProfile> = {
    all: { name: 'all', matchesConsidered: 0, weightedMatches: 0, byArchetypePair: [], byArchetype: [] },
    qualityWeighted: { name: 'qualityWeighted', matchesConsidered: 0, weightedMatches: 0, byArchetypePair: [], byArchetype: [] }
  };
  const pairMaps: Record<MatchupWeighting, Map<string, MatchupPairRow>> = { all: new Map(), qualityWeighted: new Map() };
  const archMaps: Record<MatchupWeighting, Map<string, MatchupArchetypeRow>> = { all: new Map(), qualityWeighted: new Map() };

  // Internal maps are keyed by the comparison KEY; `archetype` holds the label.
  const addSideTotals = (weighting: MatchupWeighting, key: string, label: string, weight: number, result: string): void => {
    let entry = archMaps[weighting].get(key);
    if (!entry) {
      entry = { archetype: label, matches: 0, weightedMatches: 0, weightedWins: 0, weightedLosses: 0, weightedTies: 0, weightedWinRate: 0 };
      archMaps[weighting].set(key, entry);
    }
    entry.matches += 1;
    entry.weightedMatches += weight;
    if (result === 'win') entry.weightedWins += weight;
    else if (result === 'loss') entry.weightedLosses += weight;
    else if (result === 'tie') entry.weightedTies += weight;
  };

  for (const match of event.matches) {
    if (match.participantIds.length !== 2) continue;
    if (!COUNTED_OUTCOMES.has(match.outcome)) continue;
    const [p1, p2] = match.participantIds;
    const pilot1 = pilotByParticipant.get(p1);
    const pilot2 = pilotByParticipant.get(p2);
    if (!pilot1 || !pilot2) continue;
    const arch1 = pilot1.archetype;
    const arch2 = pilot2.archetype;
    if (arch1 === 'unknown' || arch2 === 'unknown') continue;

    // Per-side result from the perspective-free outcome.
    let r1: string;
    let r2: string;
    if (match.outcome === 'tie') {
      r1 = 'tie';
      r2 = 'tie';
    } else if (match.outcome === 'double_loss') {
      r1 = 'double_loss';
      r2 = 'double_loss';
    } else {
      const p1Won = match.winnerParticipantId === p1;
      r1 = p1Won ? 'win' : 'loss';
      r2 = p1Won ? 'loss' : 'win';
    }

    const phase = match.phase ?? 1;
    const phaseMult = PHASE_MULTIPLIERS[phase] ?? 1.0;
    const qualityMult = phaseMult * ((pilot1.quality + pilot2.quality) / 2);
    const weightByProfile: Record<MatchupWeighting, number> = { all: 1.0, qualityWeighted: qualityMult };

    const [leftArch, rightArch] = arch1 <= arch2 ? [arch1, arch2] : [arch2, arch1];
    const sameOrder = arch1 === leftArch;
    const leftResult = sameOrder ? r1 : r2;

    (['all', 'qualityWeighted'] as const).forEach(weighting => {
      const weight = weightByProfile[weighting];
      const profile = profiles[weighting];
      profile.matchesConsidered += 1;
      profile.weightedMatches += weight;

      const pairKey = `${leftArch}||${rightArch}`;
      let pair = pairMaps[weighting].get(pairKey);
      if (!pair) {
        pair = {
          archetypeA: labelFor(leftArch), archetypeB: labelFor(rightArch), matches: 0, weightedMatches: 0,
          winsA: 0, winsB: 0, ties: 0, doubleLosses: 0, weightedWinsA: 0, weightedWinsB: 0,
          weightedTies: 0, weightedWinRateA: 0, weightedWinRateB: 0
        };
        pairMaps[weighting].set(pairKey, pair);
      }
      pair.matches += 1;
      pair.weightedMatches += weight;

      if (match.outcome === 'tie') {
        pair.ties += 1;
        pair.winsA += 0.5;
        pair.winsB += 0.5;
        pair.weightedWinsA += 0.5 * weight;
        pair.weightedWinsB += 0.5 * weight;
        pair.weightedTies += weight;
      } else if (match.outcome === 'double_loss') {
        pair.doubleLosses += 1;
      } else if (leftResult === 'win') {
        pair.winsA += 1;
        pair.weightedWinsA += weight;
      } else if (leftResult === 'loss') {
        pair.winsB += 1;
        pair.weightedWinsB += weight;
      }

      if (r1 === 'win' || r1 === 'loss' || r1 === 'tie') addSideTotals(weighting, arch1, labelFor(arch1), weight, r1);
      if (r2 === 'win' || r2 === 'loss' || r2 === 'tie') addSideTotals(weighting, arch2, labelFor(arch2), weight, r2);
    });
  }

  (['all', 'qualityWeighted'] as const).forEach(weighting => {
    const profile = profiles[weighting];
    profile.weightedMatches = round(profile.weightedMatches, 6);

    const pairRows = [...pairMaps[weighting].values()].map(pair => {
      const wm = pair.weightedMatches;
      pair.weightedMatches = round(wm, 6);
      pair.weightedWinsA = round(pair.weightedWinsA, 6);
      pair.weightedWinsB = round(pair.weightedWinsB, 6);
      pair.weightedTies = round(pair.weightedTies, 6);
      pair.weightedWinRateA = wm > 0 ? round((pair.weightedWinsA / wm) * 100, 3) : 0;
      pair.weightedWinRateB = wm > 0 ? round((pair.weightedWinsB / wm) * 100, 3) : 0;
      return pair;
    });
    const archRows = [...archMaps[weighting].values()].map(arc => {
      const wm = arc.weightedMatches;
      arc.weightedMatches = round(wm, 6);
      arc.weightedWins = round(arc.weightedWins, 6);
      arc.weightedLosses = round(arc.weightedLosses, 6);
      arc.weightedTies = round(arc.weightedTies, 6);
      arc.weightedWinRate = wm > 0 ? round((arc.weightedWins / wm) * 100, 3) : 0;
      return arc;
    });

    pairRows.sort((a, b) => b.weightedMatches - a.weightedMatches || (a.archetypeA < b.archetypeA ? -1 : a.archetypeA > b.archetypeA ? 1 : 0) || (a.archetypeB < b.archetypeB ? -1 : a.archetypeB > b.archetypeB ? 1 : 0));
    archRows.sort((a, b) => b.weightedMatches - a.weightedMatches || (a.archetype < b.archetype ? -1 : a.archetype > b.archetype ? 1 : 0));

    profile.byArchetypePair = pairRows;
    profile.byArchetype = archRows;
  });

  const phaseMultipliers: Record<string, number> = {};
  for (const [k, v] of Object.entries(PHASE_MULTIPLIERS)) phaseMultipliers[k] = v;

  return { phaseMultipliers, qualityModel: QUALITY_MODEL, profiles };
}
