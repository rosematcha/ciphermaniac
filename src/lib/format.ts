import type { TournamentParticipant } from '../types';
import { ONLINE_META_LABEL, ONLINE_META_NAME } from './constants';

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Format a participant's W-L(-T) record.
 *
 * Default: full `W-L-T`, and `'—'` when wins/losses/ties are all absent.
 * `compact`: omits a zero tie count (`W-L`), and returns `null` when both wins
 * and losses are absent (ties alone don't count) — the shape storyline copy
 * expects so callers can branch on truthiness.
 */
export function formatRecord(p: TournamentParticipant, opts?: { compact?: boolean }): string | null {
  const w = p.wins ?? null;
  const l = p.losses ?? null;
  const t = p.ties ?? null;
  if (opts?.compact) {
    if (w === null && l === null) {
      return null;
    }
    return `${w ?? 0}-${l ?? 0}${t ? `-${t}` : ''}`;
  }
  if (w === null && l === null && t === null) {
    return '—';
  }
  return `${w ?? 0}-${l ?? 0}-${t ?? 0}`;
}

// Values arrive already on the 0–100 scale — archetype index percents are
// scale-normalized per file in `fetchArchetypes` (see data.ts). Never rescale
// per value here: a ≤1 heuristic misreads real sub-1% shares.
export function formatPercent(p: number | null | undefined, fractionDigits = 1): string {
  if (p === null || p === undefined || !Number.isFinite(p)) {
    return '—';
  }
  return `${p.toFixed(fractionDigits)}%`;
}

const TOURNAMENT_KEY_RE = /^\d{4}-\d{2}-\d{2},\s*(.+)$/;

export function nameFromTournamentKey(key: string): string {
  if (key === ONLINE_META_NAME) {
    return ONLINE_META_LABEL;
  }
  const m = key.match(TOURNAMENT_KEY_RE);
  return m ? m[1] : key;
}

export function parseISODate(s: string | null | undefined): Date | null {
  if (!s) {
    return null;
  }
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) {
    return null;
  }
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Win percentage (0–100) from a W/L record, ties excluded, or null when
 * unplayed. Whole numbers: the player pages show this in table rows and stat
 * feet, and a tenth of a percent is noise at any sample size we publish.
 */
export function winPercent(wins: number, losses: number): number | null {
  const denom = wins + losses;
  return denom ? Math.round((wins / denom) * 100) : null;
}

/** {@link winPercent} as a display string, em dash when unplayed. */
export function winPercentLabel(wins: number, losses: number): string {
  const pct = winPercent(wins, losses);
  return pct == null ? '—' : `${pct}%`;
}

export function shortDate(d: Date | null): string {
  if (!d || Number.isNaN(d.getTime())) {
    return '—';
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const ORDINAL_SUFFIX = ['th', 'st', 'nd', 'rd'] as const;

/**
 * The English ordinal suffix alone ("st", "nd", "rd", "th"). Separate from
 * {@link ordinal} for the callers that print the numeral themselves — a
 * four-digit placement wants its thousands separator, and
 * `1,699` + `th` beats re-implementing the grouping here.
 */
export function ordinalSuffix(n: number): string {
  const abs = Math.abs(Math.trunc(n));
  const teen = abs % 100;
  return teen >= 11 && teen <= 13 ? 'th' : (ORDINAL_SUFFIX[abs % 10] ?? 'th');
}

/**
 * English ordinal for a placement ("1st", "22nd", "113th"). Placements are
 * ranks, not counts: rendering them bare reads as a quantity, and a column of
 * "1 / 797" invites the wrong comparison against the field size beside it.
 * Teens are all "th" regardless of their last digit.
 */
export function ordinal(n: number): string {
  if (!Number.isFinite(n)) {
    return '—';
  }
  return `${Math.trunc(n)}${ordinalSuffix(n)}`;
}

/** {@link ordinal} for a nullable placement, em dash when unplaced. */
export function placementLabel(placement: number | null | undefined): string {
  return placement == null ? '—' : ordinal(placement);
}
