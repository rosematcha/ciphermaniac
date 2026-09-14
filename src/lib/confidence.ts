/** A raw match record used to estimate a match-points proportion. */
export interface RateSample {
  wins: number;
  ties: number;
  total: number;
}

export interface WilsonRange {
  low: number;
  high: number;
  center: number;
}

export interface DifferenceRange {
  low: number;
  high: number;
  excludesZero: boolean;
}

export type SampleTier = 'thin' | 'ok' | 'solid';

export const WR_MIN_GAMES = 20;
export const WR_MUTE_GAMES = 50;

/**
 * Wilson score interval in percent. Fractional successes are accepted because
 * match-point win rates value each tie as one third of a win; using that same
 * effective-success count keeps the interval consistent with the shown rate.
 */
export function wilsonInterval(successes: number, n: number, z = 1.96): WilsonRange | null {
  if (n <= 0 || !Number.isFinite(successes) || !Number.isFinite(n) || successes < 0 || successes > n) {
    return null;
  }
  const p = successes / n;
  const zSquared = z * z;
  const denominator = 1 + zSquared / n;
  const center = (p + zSquared / (2 * n)) / denominator;
  const margin = (z / denominator) * Math.sqrt((p * (1 - p) + zSquared / (4 * n)) / n);
  return { low: (center - margin) * 100, high: (center + margin) * 100, center: center * 100 };
}

/** 95% normal interval for the difference `a - b`, in percentage points. */
export function differenceInterval(a: RateSample, b: RateSample, z = 1.96): DifferenceRange | null {
  if (a.total <= 0 || b.total <= 0) {
    return null;
  }
  const pa = (a.wins + a.ties / 3) / a.total;
  const pb = (b.wins + b.ties / 3) / b.total;
  const difference = pa - pb;
  const margin = z * Math.sqrt((pa * (1 - pa)) / a.total + (pb * (1 - pb)) / b.total);
  const low = (difference - margin) * 100;
  const high = (difference + margin) * 100;
  return { low, high, excludesZero: low > 0 || high < 0 };
}

/** Preserve the existing hidden/muted/fully-emphasized sample thresholds. */
export function sampleTier(n: number): SampleTier {
  if (n < WR_MIN_GAMES) {
    return 'thin';
  }
  return n < WR_MUTE_GAMES ? 'ok' : 'solid';
}

export function matchPointWilson(wins: number, ties: number, total: number): WilsonRange | null {
  return wilsonInterval(wins + ties / 3, total);
}
