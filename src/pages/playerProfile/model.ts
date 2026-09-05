/**
 * Pure helpers behind the player profile: how a finish is described, how the
 * career rounds roll up into matchups, phases and repeat opponents, and the
 * short event names the phone table needs. No Solid in here so it all tests
 * in Node.
 * @module pages/playerProfile/model
 */
import { nameFromTournamentKey } from '../../lib/format';
import { tournamentDate } from '../../../shared/data/tournamentKeys';
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
  const name = nameFromTournamentKey(key);
  const regional = name.match(/^Regional Championship (.+)$/);
  if (regional) {
    return `${regional[1]} Regional`;
  }
  const international = name.match(/^International Championship (.+)$/);
  if (international) {
    return `${international[1]} International`;
  }
  const worlds = name.match(/^World Championships? (\d{4})$/);
  if (worlds) {
    return `Worlds ${worlds[1]}`;
  }
  const special = name.match(/^Special Event (.+)$/);
  if (special) {
    return `${special[1]} Special Event`;
  }
  return name;
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

/**
 * Which column of a record one outcome adds to; unpaired rounds add to none.
 *
 * `countByes` is the difference between the two questions a record can answer.
 * Upstream standings count a bye as a win — a career published as 182-103-71
 * has 180 played wins and two byes — so any record that has to reconcile with
 * the one in the hero band counts them too. A record about opponents does not:
 * a bye has no opponent and no deck, so it belongs in neither a matchup line
 * nor a head-to-head.
 */
function tallyColumn(outcome: PlayerRound['outcome'], countByes: boolean): keyof Tally | null {
  if (outcome === 'win' || (countByes && outcome === 'bye')) {
    return 'wins';
  }
  if (outcome === 'loss' || outcome === 'double_loss') {
    return 'losses';
  }
  return outcome === 'tie' ? 'ties' : null;
}

function tally<T extends Tally>(row: T, outcome: PlayerRound['outcome'], countByes = false): T {
  const column = tallyColumn(outcome, countByes);
  return column ? { ...row, [column]: row[column] + 1 } : row;
}

function allRounds(rounds: CareerRounds): PlayerRound[] {
  return Object.values(rounds).flat();
}

export interface MatchupRow extends Tally {
  archetype: string;
  games: number;
  /** 0–1 over decided games; null when every meeting tied. */
  winRate: number | null;
}

/** Career record against each opponent deck, most-faced first. Byes have no deck and are skipped. */
export function matchupRollup(rounds: CareerRounds): MatchupRow[] {
  const byDeck = new Map<string, MatchupRow>();
  for (const round of allRounds(rounds)) {
    if (!round.opponentArchetype) {
      continue;
    }
    const row = byDeck.get(round.opponentArchetype) ?? {
      archetype: round.opponentArchetype,
      wins: 0,
      losses: 0,
      ties: 0,
      games: 0,
      winRate: null
    };
    byDeck.set(round.opponentArchetype, tally(row, round.outcome));
  }
  return [...byDeck.values()]
    .map(row => ({
      ...row,
      games: row.wins + row.losses + row.ties,
      winRate: row.wins + row.losses ? row.wins / (row.wins + row.losses) : null
    }))
    .sort((a, b) => b.games - a.games || a.archetype.localeCompare(b.archetype));
}

export interface PhaseRow extends Tally {
  label: string;
}

/**
 * Record in Day 1 Swiss, Day 2 Swiss and top cut, in that order; phases never
 * played are omitted.
 *
 * Byes count as wins here. These three rows are the career record split by
 * phase, and the career record they split is the one the hero band prints from
 * upstream standings — which count byes. Leaving them out made the band read
 * one or two wins short of the figure directly above it.
 */
export function phaseSplit(rounds: CareerRounds): PhaseRow[] {
  const rows = new Map<number, PhaseRow>();
  for (const round of allRounds(rounds)) {
    if (round.phase == null) {
      continue;
    }
    const row = rows.get(round.phase) ?? { label: phaseLabel(round.phase), wins: 0, losses: 0, ties: 0 };
    rows.set(round.phase, tally(row, round.outcome, true));
  }
  return [...rows.entries()].sort(([a], [b]) => a - b).map(([, row]) => row);
}

export interface RepeatOpponent extends Tally {
  /** Career id when they have one, for a profile link. */
  playerId: string | null;
  name: string;
  country: string | null;
  meetings: number;
  /** Tournament keys where they met, most recent first. */
  events: string[];
}

/**
 * Opponents met at least {@link REPEAT_MIN_MEETINGS} times, most-met first.
 * Keyed by career id when there is one, else by name, so a rename that has
 * already been resolved upstream cannot split one person into two rows.
 */
export function repeatOpponents(rounds: CareerRounds): RepeatOpponent[] {
  const byKey = new Map<string, RepeatOpponent>();
  const eventKeys = Object.keys(rounds).sort((a, b) => b.localeCompare(a));
  for (const tournamentId of eventKeys) {
    for (const round of rounds[tournamentId]) {
      if (!round.opponentName) {
        continue;
      }
      const key = round.opponentId ? `id:${round.opponentId}` : `name:${round.opponentName}`;
      const row = tally(
        byKey.get(key) ?? {
          playerId: round.opponentId,
          name: round.opponentName,
          country: round.opponentCountry,
          wins: 0,
          losses: 0,
          ties: 0,
          meetings: 0,
          events: []
        },
        round.outcome
      );
      byKey.set(key, {
        ...row,
        meetings: row.meetings + 1,
        events: row.events.includes(tournamentId) ? row.events : [...row.events, tournamentId]
      });
    }
  }
  return [...byKey.values()]
    .filter(row => row.meetings >= REPEAT_MIN_MEETINGS)
    .sort((a, b) => b.meetings - a.meetings || a.name.localeCompare(b.name));
}

/** How many different opponents the rounds name. */
export function distinctOpponents(rounds: CareerRounds): number {
  const seen = new Set<string>();
  for (const round of allRounds(rounds)) {
    if (round.opponentName) {
      seen.add(round.opponentId ? `id:${round.opponentId}` : `name:${round.opponentName}`);
    }
  }
  return seen.size;
}
