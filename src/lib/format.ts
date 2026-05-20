import type { TournamentParticipant } from '../types';
import { ONLINE_META_LABEL, ONLINE_META_NAME } from './constants';

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function formatRecord(p: TournamentParticipant): string {
  return `${p.wins ?? 0}-${p.losses ?? 0}-${p.ties ?? 0}`;
}

// Per-tournament archetype index sometimes uses 0..1 and sometimes 0..100;
// anything ≤ 1 is treated as a fraction.
export function normalizePercent(p: number | null | undefined): number {
  if (p === null || p === undefined || !Number.isFinite(p)) {
    return 0;
  }
  return p <= 1 ? p * 100 : p;
}

export function formatPercent(p: number | null | undefined, fractionDigits = 1): string {
  if (p === null || p === undefined || !Number.isFinite(p)) {
    return '—';
  }
  return `${normalizePercent(p).toFixed(fractionDigits)}%`;
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
