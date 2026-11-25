/**
 * The deck graphics: which decks converted to Day 2 and how the most played
 * decks did against each other.
 *
 * Both read the event's players file, where every player carries their deck
 * and whether they made Day 2, so the counts match the site's own reports.
 * @module src/pages/socialGraphics/decks
 */

import { wilsonInterval } from '../../lib/confidence';
import { normalizeArchetypeKey } from '../../../shared/data/archetypes/winRate';
import type { MatchupPair } from '../../lib/data/matchups';
import type { TournamentParticipant } from '../../types';

/** One deck's Day 1 to Day 2 conversion. */
export interface DeckConversionRow {
  label: string;
  decks: number;
  rate: number;
  /** Beats the field by more than chance: the rate's 95% Wilson lower bound clears the field's rate. */
  beatsField: boolean;
}

export interface DeckConversion {
  /** The share of all listed decks that made Day 2. */
  fieldRate: number;
  rows: DeckConversionRow[];
}

/** A grid cell needs this many matches before its win rate is shown. */
export const MATCHUP_MIN_MATCHES = 10;

export interface MatchupGrid {
  decks: string[];
  /** Row deck's win rate against the column deck, or null on the diagonal and for thin pairs. */
  rates: (number | null)[][];
  /** The fewest matches behind any shown cell. */
  fewestMatches: number;
}

interface DeckTally {
  label: string;
  decks: number;
  day2: number;
}

/** Players grouped by deck, most played first. "Other" is not a deck, so it is left out. */
function tallyDecks(players: readonly TournamentParticipant[]): DeckTally[] {
  const byKey = new Map<string, DeckTally>();
  for (const p of players) {
    const label = p.deckName;
    const key = normalizeArchetypeKey(label);
    if (!label || key === 'other') {
      continue;
    }
    const tally = byKey.get(key) ?? { label, decks: 0, day2: 0 };
    tally.decks += 1;
    tally.day2 += p.madePhase2 ? 1 : 0;
    byKey.set(key, tally);
  }
  return [...byKey.values()].sort((a, b) => b.decks - a.decks);
}

/** The labels of the `count` most played decks. */
export function topDecks(players: readonly TournamentParticipant[], count: number): string[] {
  return tallyDecks(players)
    .slice(0, count)
    .map(t => t.label);
}

/**
 * Day 2 conversion of the most played decks, best rate first.
 * @param players - The event's players
 * @param count - How many of the most played decks to rank
 * @returns The ranking, or null when the event has no Day 2 cut
 */
export function deckConversion(players: readonly TournamentParticipant[], count: number): DeckConversion | null {
  const listed = players.filter(p => p.deckName);
  const day2 = listed.filter(p => p.madePhase2).length;
  if (day2 === 0) {
    return null;
  }
  const fieldRate = (day2 / listed.length) * 100;
  const rows = tallyDecks(players)
    .slice(0, count)
    .map(t => ({
      label: t.label,
      decks: t.decks,
      rate: (t.day2 / t.decks) * 100,
      beatsField: (wilsonInterval(t.day2, t.decks)?.low ?? 0) > fieldRate
    }))
    .sort((a, b) => b.rate - a.rate || b.decks - a.decks);
  return { fieldRate, rows };
}

/** One deck's record against another, from whichever side of the pair it sits on. */
function recordOf(pair: MatchupPair, rowKey: string): { wins: number; matches: number } {
  const wins = normalizeArchetypeKey(pair.archetypeA) === rowKey ? pair.winsA : pair.winsB;
  return { wins, matches: pair.matches };
}

/**
 * Win rates between the given decks. Ties already count as half a win in
 * `winsA`/`winsB`.
 * @param pairs - The event's unweighted archetype pairs
 * @param decks - The decks, in grid order
 * @returns The grid, row deck against column deck
 */
export function matchupGrid(pairs: readonly MatchupPair[], decks: readonly string[]): MatchupGrid {
  const keys = decks.map(normalizeArchetypeKey);
  const byPair = new Map<string, MatchupPair>();
  for (const pair of pairs) {
    const a = normalizeArchetypeKey(pair.archetypeA);
    const b = normalizeArchetypeKey(pair.archetypeB);
    byPair.set(`${a}|${b}`, pair).set(`${b}|${a}`, pair);
  }
  let fewestMatches = Infinity;
  const rates = keys.map(row =>
    keys.map(col => {
      const pair = row === col ? undefined : byPair.get(`${row}|${col}`);
      if (!pair || pair.matches < MATCHUP_MIN_MATCHES) {
        return null;
      }
      const { wins, matches } = recordOf(pair, row);
      fewestMatches = Math.min(fewestMatches, matches);
      return (wins / matches) * 100;
    })
  );
  return { decks: [...decks], rates, fewestMatches: Number.isFinite(fewestMatches) ? fewestMatches : 0 };
}
