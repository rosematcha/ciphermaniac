/**
 * Pure helpers behind the player profile: how a finish is described, how the
 * career rounds roll up into matchups, phases and repeat opponents, and the
 * short event names the phone table needs. No Solid in here so it all tests
 * in Node.
 * @module pages/playerProfile/model
 */
import { nameFromTournamentKey } from '../../lib/format';
import { shortTournamentName as formatShortTournamentName, tournamentDate } from '../../../shared/data/tournamentKeys';
import type { PlayerProfile, PlayerRound, PlayerTournamentEntry } from '../../types';

/**
 * Every round a player has played, keyed by event (see {@link PlayerProfile.rounds}).
 * Non-optional: the page substitutes an empty map for a profile that predates
 * the field, so nothing below has to re-check.
 */
export type CareerRounds = NonNullable<PlayerProfile['rounds']>;

/** A deck must be faced this many times before its record is listed. */
export const MATCHUP_MIN_GAMES = 5;
/** An opponent must be met this many times before they count as a repeat. */
export const REPEAT_MIN_MEETINGS = 2;

/** "Regional Championship Indianapolis" → "Indianapolis Regional", and so on. */
export function shortTournamentName(key: string): string {
  return formatShortTournamentName(nameFromTournamentKey(key));
}

/** "Jun 12, 2026" from a tournament key, or an empty string when it carries no date. */
export function tournamentDateLabel(key: string): string {
  const date = tournamentDate(key);
  return date ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
}

/** "Sep 2024" from an ISO date. */
export function monthYear(iso: string): string {
  const [y, m] = iso.split('-').map(Number);
  if (!y || !m) {
    return '';
  }
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

/** Placement as a share of the field, 0–1; null when either number is missing. */
export function finishShare(entry: Pick<PlayerTournamentEntry, 'placement' | 'totalPlayers'>): number | null {
  if (!entry.placement || !entry.totalPlayers) {
    return null;
  }
  return entry.placement / entry.totalPlayers;
}

/** "Won", "Top 5%", or an em dash. Whole numbers only, never below 1%. */
export function finishLabel(entry: Pick<PlayerTournamentEntry, 'placement' | 'totalPlayers'>): string {
  if (!entry.placement) {
    return '—';
  }
  if (entry.placement === 1) {
    return 'Won';
  }
  const share = finishShare(entry);
  return share == null ? `#${entry.placement}` : `Top ${Math.max(1, Math.ceil(share * 100))}%`;
}

/** Whole-number win rate over decided games, or null with none played. */
export function winRateWhole(wins: number, losses: number): number | null {
  const games = wins + losses;
  return games ? Math.round((wins / games) * 100) : null;
}

export interface CareerSummary {
  record: string;
  winRate: number | null;
  games: number;
  day2Rate: number;
  /** "Top 5%": the median of the player's finishes as a share of the field. */
  medianFinish: string;
  /** The event they won, if exactly one title; otherwise null. */
  titleEvent: string | null;
  span: string;
}

export function careerSummary(profile: PlayerProfile): CareerSummary {
  const s = profile.summary;
  const shares = profile.tournaments
    .map(finishShare)
    .filter((v): v is number => v != null)
    .sort((a, b) => a - b);
  const median = shares.length ? shares[Math.floor(shares.length / 2)] : null;
  const titles = profile.tournaments.filter(t => t.placement === 1);
  return {
    record: `${s.wins}-${s.losses}-${s.ties}`,
    winRate: winRateWhole(s.wins, s.losses),
    games: s.wins + s.losses,
    day2Rate: s.eventCount ? Math.round((s.day2s / s.eventCount) * 100) : 0,
    medianFinish: median == null ? '—' : `Top ${Math.max(1, Math.ceil(median * 100))}%`,
    titleEvent: titles.length === 1 ? shortTournamentName(titles[0].tournamentId) : null,
    span: `${monthYear(s.firstEventDate)} – ${monthYear(s.lastEventDate)}`
  };
}

export const OUTCOME_LETTER: Record<PlayerRound['outcome'], string> = {
  win: 'W',
  loss: 'L',
  tie: 'T',
  // eslint-disable-next-line camelcase -- the outcome vocabulary is the match data's
  double_loss: 'L',
  bye: 'Bye',
  unpaired: '–',
  unknown: '?'
};

/** win / loss / tie bucket for colouring, or null for byes and unpaired rounds. */
export function outcomeTone(outcome: PlayerRound['outcome']): 'win' | 'loss' | 'tie' | null {
  switch (outcome) {
    case 'win':
    case 'bye':
      return 'win';
    case 'loss':
    case 'double_loss':
      return 'loss';
    case 'tie':
      return 'tie';
    case 'unpaired':
    case 'unknown':
    default:
      return null;
  }
}

export function phaseLabel(phase: number | null): string {
  if (phase === 1) {
    return 'Day 1';
  }
  if (phase === 2) {
    return 'Day 2';
  }
  if (phase === 3) {
    return 'Top cut';
  }
  return 'Rounds';
}

export interface RoundGroup {
  label: string;
  rounds: PlayerRound[];
}

/** Rounds split into consecutive phase groups, in play order. */
export function groupRoundsByPhase(rounds: PlayerRound[]): RoundGroup[] {
  const groups: RoundGroup[] = [];
  for (const round of rounds) {
    const label = phaseLabel(round.phase);
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.rounds.push(round);
    } else {
      groups.push({ label, rounds: [round] });
    }
  }
  return groups;
}

interface Tally {
  wins: number;
  losses: number;
  ties: number;
}

/** Played win / loss / tie bucket; byes are added only to phase records. */
function tallyColumn(outcome: PlayerRound['outcome']): keyof Tally | null {
  if (outcome === 'win') {
    return 'wins';
  }
  if (outcome === 'loss' || outcome === 'double_loss') {
    return 'losses';
  }
  return outcome === 'tie' ? 'ties' : null;
}

function tally(row: Tally, column: keyof Tally | null): void {
  if (column) {
    row[column] += 1;
  }
}

export interface MatchupRow extends Tally {
  archetype: string;
  games: number;
  /** 0–1 over decided games; null when every meeting tied. */
  winRate: number | null;
}

export interface PhaseRow extends Tally {
  label: string;
}

export interface RepeatOpponent extends Tally {
  playerId: string | null;
  name: string;
  country: string | null;
  meetings: number;
  /** Tournament keys where they met, most recent first. */
  events: string[];
}

export interface CareerRoundAggregates {
  hasEvents: boolean;
  matchups: MatchupRow[];
  phases: PhaseRow[];
  repeats: RepeatOpponent[];
  opponents: number;
}

function addMatchup(byDeck: Map<string, MatchupRow>, round: PlayerRound, column: keyof Tally | null): void {
  if (!round.opponentArchetype) {
    return;
  }
  let row = byDeck.get(round.opponentArchetype);
  if (!row) {
    row = { archetype: round.opponentArchetype, wins: 0, losses: 0, ties: 0, games: 0, winRate: null };
    byDeck.set(round.opponentArchetype, row);
  }
  tally(row, column);
}

function addPhase(byPhase: Map<number, PhaseRow>, round: PlayerRound, column: keyof Tally | null): void {
  if (round.phase == null) {
    return;
  }
  let row = byPhase.get(round.phase);
  if (!row) {
    row = { label: phaseLabel(round.phase), wins: 0, losses: 0, ties: 0 };
    byPhase.set(round.phase, row);
  }
  tally(row, round.outcome === 'bye' ? 'wins' : column);
}

function addOpponent(
  byOpponent: Map<string, RepeatOpponent>,
  round: PlayerRound,
  tournamentId: string,
  column: keyof Tally | null
): void {
  if (!round.opponentName) {
    return;
  }
  const key = round.opponentId ? `id:${round.opponentId}` : `name:${round.opponentName}`;
  let row = byOpponent.get(key);
  if (!row) {
    row = {
      playerId: round.opponentId,
      name: round.opponentName,
      country: round.opponentCountry,
      wins: 0,
      losses: 0,
      ties: 0,
      meetings: 0,
      events: []
    };
    byOpponent.set(key, row);
  }
  tally(row, column);
  row.meetings += 1;
  // Events are visited consecutively, newest first. Only the last key can repeat.
  if (row.events[row.events.length - 1] !== tournamentId) {
    row.events.push(tournamentId);
  }
}

function finishMatchups(byDeck: Map<string, MatchupRow>): MatchupRow[] {
  const rows = [...byDeck.values()];
  for (const row of rows) {
    row.games = row.wins + row.losses + row.ties;
    row.winRate = row.wins + row.losses ? row.wins / (row.wins + row.losses) : null;
  }
  return rows.sort((a, b) => b.games - a.games || a.archetype.localeCompare(b.archetype));
}

/**
 * Roll up every event in one pass without flattening the career history.
 * Only newly allocated tallies are mutated; profile rounds stay untouched.
 * Byes count toward phase records, but never opponent records. Opponent names
 * and countries come from the most recent event, keyed by career id or name.
 */
export function careerRoundAggregates(rounds: CareerRounds): CareerRoundAggregates {
  const byDeck = new Map<string, MatchupRow>();
  const byPhase = new Map<number, PhaseRow>();
  const byOpponent = new Map<string, RepeatOpponent>();
  const eventKeys = Object.keys(rounds).sort((a, b) => b.localeCompare(a));
  for (const tournamentId of eventKeys) {
    for (const round of rounds[tournamentId]) {
      const column = tallyColumn(round.outcome);
      addMatchup(byDeck, round, column);
      addPhase(byPhase, round, column);
      addOpponent(byOpponent, round, tournamentId, column);
    }
  }
  return {
    hasEvents: eventKeys.length > 0,
    matchups: finishMatchups(byDeck),
    phases: [...byPhase.entries()].sort(([a], [b]) => a - b).map(([, row]) => row),
    repeats: [...byOpponent.values()]
      .filter(row => row.meetings >= REPEAT_MIN_MEETINGS)
      .sort((a, b) => b.meetings - a.meetings || a.name.localeCompare(b.name)),
    opponents: byOpponent.size
  };
}
