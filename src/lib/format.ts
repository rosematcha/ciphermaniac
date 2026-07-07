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

/** Win percentage (0–100, one decimal) from a W/L record, or null when unplayed. */
export function winPercent(wins: number, losses: number): number | null {
  const denom = wins + losses;
  if (!denom) {
    return null;
  }
  return Math.round((wins / denom) * 1000) / 10;
}

export function shortDate(d: Date | null): string {
  if (!d || Number.isNaN(d.getTime())) {
    return '—';
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
