/**
 * Event match serving builders.
 *
 * Produces the two match serving artifacts — `playerMatches.json` (per-pilot
 * perspective rows, consumed by the card-lens win-rate analysis and the
 * matchups panel) and `matches.json` (perspective-free canonical rows) — from
 * the NORMALIZED event contract rather than from raw Limitless rows. Names,
 * countries, archetype labels and phase flags are resolved by joining each
 * match's `participantIds` back to the event's participants and decks, so these
 * builders carry no source-fetching or canonicalization policy of their own.
 *
 * This replaces the inline construction in `.github/scripts/download-tournament.py`
 * (`playerMatches`/`canonical_matches` assembly, `extract_player_outcome`,
 * `derive_canonical_outcome`). The perspective-free outcome already lives on the
 * normalized {@link Match}; the per-side outcome is derived here.
 * @module shared/data/reports/eventMatches
 */

import type { Match, MatchOutcome, NormalizedEvent } from '../contracts';

/** One pilot's single round, from that pilot's perspective. */
export interface PlayerMatchRow {
  id: string;
  playerId: string;
  playerName: string | null;
  opponentId: string | null;
  opponentName: string | null;
  opponentCountry: string | null;
  opponentArchetype: string | null;
  playerArchetype: string | null;
  round: number;
  phase: number | null;
  table: number | null;
  completed: boolean;
  outcome: PlayerMatchOutcome;
  madePhase2: boolean;
  madeTopCut: boolean;
}

/** Per-side outcome (the perspective-free {@link MatchOutcome} plus win/loss). */
export type PlayerMatchOutcome = 'win' | 'loss' | 'tie' | 'double_loss' | 'bye' | 'unpaired' | 'unknown';

/** One perspective-free canonical match row. */
export interface CanonicalMatchRow {
  id: string;
  round: number;
  phase: number | null;
  table: number | null;
  completed: boolean;
  participant1Id: string;
  participant2Id: string | null;
  participant1Name: string | null;
  participant2Name: string | null;
  participant1Country: string | null;
  participant2Country: string | null;
  participant1Archetype: string | null;
  participant2Archetype: string | null;
  outcome: MatchOutcome;
  winnerParticipantId: string | null;
  participant1MadePhase2: boolean | null;
  participant1MadeTopCut: boolean | null;
  participant2MadePhase2: boolean | null;
  participant2MadeTopCut: boolean | null;
}

interface ParticipantView {
  name: string | null;
  country: string | null;
  madePhase2: boolean;
  madeTopCut: boolean;
}

function participantViews(event: NormalizedEvent): Map<string, ParticipantView> {
  const views = new Map<string, ParticipantView>();
  for (const participant of event.participants) {
    views.set(participant.participantId, {
      name: participant.name ?? null,
      country: participant.country ?? null,
      madePhase2: participant.flags.madePhase2 === true,
      madeTopCut: participant.flags.madeTopCut === true
    });
  }
  return views;
}

/** participantId -> archetype display label (from that pilot's deck). */
function archetypeLabels(event: NormalizedEvent): Map<string, string> {
  const labels = new Map<string, string>();
  for (const deck of event.decks) {
    labels.set(deck.participantId, deck.archetype.displayName);
  }
  return labels;
}

/**
 * Derive a pilot's per-side outcome from the perspective-free match outcome.
 * Solo outcomes (bye/unpaired/unknown) pass through; a decided match is a win
 * for the winner and a loss for the other participant.
 */
function sideOutcome(match: Match, meId: string): PlayerMatchOutcome {
  switch (match.outcome) {
    case 'decided':
      return match.winnerParticipantId === meId ? 'win' : 'loss';
    case 'tie':
      return 'tie';
    case 'double_loss':
      return 'double_loss';
    case 'bye':
      return 'bye';
    case 'unpaired':
      return 'unpaired';
    default:
      return 'unknown';
  }
}

/**
 * Build the per-pilot perspective match rows (`playerMatches.json`). Every
 * participant in every match contributes one row. Sorted by (round, playerId)
 * with an explicit total order so input order cannot change the bytes.
 * @param event - Normalized event
 * @returns Player match rows in deterministic order
 */
export function buildPlayerMatches(event: NormalizedEvent): PlayerMatchRow[] {
  const views = participantViews(event);
  const labels = archetypeLabels(event);
  const rows: PlayerMatchRow[] = [];

  for (const match of event.matches) {
    const ids = match.participantIds;
    ids.forEach((meId, index) => {
      const opponentId = ids.length === 2 ? ids[1 - index] : null;
      const me = views.get(meId);
      const opponent = opponentId ? views.get(opponentId) : undefined;
      rows.push({
        id: `${meId}:r${match.round}`,
        playerId: meId,
        playerName: me?.name ?? null,
        opponentId,
        opponentName: opponent?.name ?? null,
        opponentCountry: opponent?.country ?? null,
        opponentArchetype: opponentId ? labels.get(opponentId) ?? null : null,
        playerArchetype: labels.get(meId) ?? null,
        round: match.round,
        phase: match.phase ?? null,
        table: match.table ?? null,
        completed: match.completed,
        outcome: sideOutcome(match, meId),
        madePhase2: me?.madePhase2 ?? false,
        madeTopCut: me?.madeTopCut ?? false
      });
    });
  }

  rows.sort((a, b) => a.round - b.round || (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0));
  return rows;
}

/**
 * Build the perspective-free canonical match rows (`matches.json`). One row per
 * match. Sorted by (round, table, id) with explicit tie-breakers.
 * @param event - Normalized event
 * @returns Canonical match rows in deterministic order
 */
export function buildCanonicalMatches(event: NormalizedEvent): CanonicalMatchRow[] {
  const views = participantViews(event);
  const labels = archetypeLabels(event);

  const rows: CanonicalMatchRow[] = event.matches.map(match => {
    const p1 = match.participantIds[0];
    const p2 = match.participantIds.length === 2 ? match.participantIds[1] : null;
    const v1 = views.get(p1);
    const v2 = p2 ? views.get(p2) : undefined;
    return {
      id: match.matchId,
      round: match.round,
      phase: match.phase ?? null,
      table: match.table ?? null,
      completed: match.completed,
      participant1Id: p1,
      participant2Id: p2,
      participant1Name: v1?.name ?? null,
      participant2Name: v2?.name ?? null,
      participant1Country: v1?.country ?? null,
      participant2Country: v2?.country ?? null,
      participant1Archetype: labels.get(p1) ?? null,
      participant2Archetype: p2 ? labels.get(p2) ?? null : null,
      outcome: match.outcome,
      winnerParticipantId: match.winnerParticipantId,
      participant1MadePhase2: v1 ? v1.madePhase2 : null,
      participant1MadeTopCut: v1 ? v1.madeTopCut : null,
      participant2MadePhase2: v2 ? v2.madePhase2 : null,
      participant2MadeTopCut: v2 ? v2.madeTopCut : null
    };
  });

  rows.sort(
    (a, b) =>
      a.round - b.round || (a.table ?? 0) - (b.table ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
  return rows;
}
