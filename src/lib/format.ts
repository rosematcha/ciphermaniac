import type { TournamentParticipant } from '../types';
import { ONLINE_META_LABEL, ONLINE_META_NAME } from './constants';

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function formatRecord(p: TournamentParticipant): string {
  if (p.wins == null && p.losses == null && p.ties == null) {
    return '—';
  }
  return `${p.wins ?? 0}-${p.losses ?? 0}-${p.ties ?? 0}`;
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

export function shortDate(d: Date | null): string {
  if (!d || Number.isNaN(d.getTime())) {
    return '—';
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
