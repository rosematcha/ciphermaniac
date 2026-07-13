/**
 * Pure normalization of the two matchup source schemas into a single row shape.
 *
 * Majors store `matchupProfiles.json` (archetype-vs-archetype, three weighting
 * models, ties folded into winsA/winsB as 0.5). Online stores a simpler
 * `opponent → {wins,losses,ties,total,winRate}` map inside each archetype's
 * trends.json. Both collapse to `MatchupRowCore` here; the component layers
 * opponent slug/icons on top. Kept free of Solid + DOM so it's unit-testable.
 */
import { type MatchupProfile, normalizeArchetypeKey, type OnlineMatchupRecord } from './data';

/** A win is worth 3× a tie — Pokémon match points (win 3, tie 1, loss 0). */
const TIE_VALUE = 1 / 3;

/** Win rate from wins + ties over total games, valuing a tie at {@link TIE_VALUE} of a win. */
export function pointsWinRate(wins: number, ties: number, total: number): number {
  return total > 0 ? ((wins + ties * TIE_VALUE) / total) * 100 : 0;
}

/** Pseudo-games added by {@link shrunkWinRate} to pull small samples toward 50%. */
const SHRINK_PSEUDO_GAMES = 10;

/**
 * Sample-size-adjusted win rate (0..1) used purely to ORDER rows, never displayed.
 * Adds {@link SHRINK_PSEUDO_GAMES} pseudo-games at 50% so a 2-0 fringe matchup can't
 * outrank a proven 65% over 200 games. Ties count as {@link TIE_VALUE} of a win.
 */
export function shrunkWinRate(wins: number, ties: number, matches: number): number {
  const effWins = wins + ties * TIE_VALUE;
  return (effWins + SHRINK_PSEUDO_GAMES * 0.5) / (matches + SHRINK_PSEUDO_GAMES);
}

/**
 * Minimum games for a matchup to count in the overview summary, be eligible as a
 * key matchup, or appear in the main "rest of the field" list. Rows below this are
 * low-sample: hidden behind the expander and shown without a win-rate readout.
 */
export const WR_MIN_GAMES = 20;

/**
 * Guaranteed number of matchups that render with a win-rate readout, even when
 * they sit below {@link WR_MIN_GAMES}. A low-playrate deck plays so few total
 * games that every one of its matchups is thin, so a hard floor would surface
 * nothing; this floors the shown set at the deck's most-played opponents so the
 * panel is never empty. The W-L-T record beside each row keeps the (small)
 * sample visible in lieu of any hidden confidence threshold.
 */
export const MIN_SHOWN = 8;

/**
 * Labels of the matchups that should render with a win rate. Every row meeting
 * `minGames` qualifies; if fewer than `minShown` do, the most-played sub-floor
 * rows fill in up to `minShown`. For well-sampled decks this is exactly the rows
 * meeting the floor (unchanged behaviour); for low-playrate decks it guarantees
 * their top matchups still show instead of hiding behind the expander.
 */
export function shownMatchups<T extends { opponentLabel: string; matches: number }>(
  rows: T[],
  minGames = WR_MIN_GAMES,
  minShown = MIN_SHOWN
): Set<string> {
  const met = rows.filter(r => r.matches >= minGames);
  if (met.length >= minShown) {
    return new Set(met.map(r => r.opponentLabel));
  }
  const filled = [...rows].sort((a, b) => b.matches - a.matches).slice(0, minShown);
  return new Set([...met, ...filled].map(r => r.opponentLabel));
}

/** Overview bucket a matchup falls into, by its DISPLAYED whole-number win rate. */
export type MatchupBucket = 'fav' | 'even' | 'unf';

/**
 * Bucket a matchup by its DISPLAYED whole-number win rate (Math.round): 48-52
 * inclusive counts as even, strictly above as favored, strictly below as
 * unfavored. This is the overview-count convention only; per-row tone still keys
 * off the exact 50% center so a rounded-52 row can read green while counting even.
 */
export function bucketWinRate(winRate: number): MatchupBucket {
  const wr = Math.round(winRate);
  if (wr >= 48 && wr <= 52) {
    return 'even';
  }
  return wr > 52 ? 'fav' : 'unf';
}

/**
 * Deviation (in pp from 50) that fills the gauge track completely. Set to 30 so
 * an 80/20 matchup — realistically near-unwinnable — reads as fully lopsided, and
 * a 65/35 reads as half. Deviations beyond 30pp clamp to full.
 */
export const GAUGE_FULL_DEVIATION = 30;

/**
 * Gauge fill as a percentage (0..100) of the track: the deviation |WR − 50|
 * scaled so ±{@link GAUGE_FULL_DEVIATION}pp fills the whole track. Even matchups
 * fill nothing.
 */
export function gaugeWidth(winRate: number): number {
  const dev = Math.abs(winRate - 50);
  return Math.max(0, Math.min(100, (dev / GAUGE_FULL_DEVIATION) * 100));
}

/** The minimal per-opponent shape the overview + key-selection helpers need. */
export interface MatchupStat {
  opponentLabel: string;
  /** 0..100 displayed win rate. */
  winRate: number;
  matches: number;
  /** Opponent's share of the field (a percent like 12.7), or null if unknown. */
  fieldShare: number | null;
  isMirror: boolean;
}

export interface MatchupSummary {
  favored: number;
  even: number;
  unfavored: number;
  /** favored + even + unfavored (rows meeting the games floor). */
  tracked: number;
  /**
   * Per-bucket sum of opponent field share (percent), for popularity-weighting the
   * overview strip. Opponents with unknown share (null) contribute 0. Sums are not
   * normalized — the strip divides by their total.
   */
  favoredShare: number;
  evenShare: number;
  unfavoredShare: number;
  best: { label: string; winRate: number } | null;
  toughest: { label: string; winRate: number } | null;
}

/**
 * Overview counts + best/toughest opponent, over rows meeting the games floor
 * (mirror included — a 50% mirror simply counts as even). Bucketing follows
 * {@link bucketWinRate}; best/toughest are the highest/lowest displayed win rate.
 */
export function summarizeMatchups(rows: MatchupStat[], minGames = WR_MIN_GAMES): MatchupSummary {
  let favored = 0;
  let even = 0;
  let unfavored = 0;
  let favoredShare = 0;
  let evenShare = 0;
  let unfavoredShare = 0;
  let best: { label: string; winRate: number } | null = null;
  let toughest: { label: string; winRate: number } | null = null;
  let tracked = 0;
  for (const r of rows) {
    if (r.matches < minGames) {
      continue;
    }
    tracked += 1;
    const share = r.fieldShare ?? 0;
    const bucket = bucketWinRate(r.winRate);
    if (bucket === 'fav') {
      favored += 1;
      favoredShare += share;
    } else if (bucket === 'even') {
      even += 1;
      evenShare += share;
    } else {
      unfavored += 1;
      unfavoredShare += share;
    }
    if (!best || r.winRate > best.winRate) {
      best = { label: r.opponentLabel, winRate: r.winRate };
    }
    if (!toughest || r.winRate < toughest.winRate) {
      toughest = { label: r.opponentLabel, winRate: r.winRate };
    }
  }
  return { favored, even, unfavored, tracked, favoredShare, evenShare, unfavoredShare, best, toughest };
}

/** Decision-relevance of a matchup: field share weighted by how lopsided it is. */
export function matchupImportance(row: MatchupStat): number {
  return (row.fieldShare ?? 0) * Math.sqrt(Math.max(Math.abs(row.winRate - 50), 1));
}

/**
 * The most decision-relevant opponents. Among rows meeting the games floor and
 * excluding the mirror, rank by {@link matchupImportance} and take the top
 * `count`, then return them ordered by field share (descending) for display.
 */
export function selectKeyMatchups<T extends MatchupStat>(rows: T[], minGames = WR_MIN_GAMES, count = 5): T[] {
  const eligible = rows.filter(r => !r.isMirror && r.matches >= minGames);
  const top = [...eligible].sort((a, b) => matchupImportance(b) - matchupImportance(a)).slice(0, count);
  return top.sort((a, b) => (b.fieldShare ?? 0) - (a.fieldShare ?? 0));
}

export interface MatchupRowCore {
  /** Clean opponent display label (no "(mirror)" suffix). */
  opponentLabel: string;
  isMirror: boolean;
  /** Raw wins/losses for the current archetype (ties excluded). */
  wins: number;
  losses: number;
  ties: number;
  doubleLosses: number;
  /** Total games played in this matchup. */
  matches: number;
  /** 0..100, valuing a tie at {@link TIE_VALUE} of a win (match points). */
  winRate: number;
}

/**
 * Mirror matches are 50/50 by definition — the A/B (or player1/player2) split is
 * arbitrary labeling. Present the record symmetrically so the row reads honestly.
 */
export function mirrorRecord(
  matches: number,
  ties: number,
  doubleLosses: number
): { wins: number; losses: number; winRate: number } {
  const decisive = Math.max(0, matches - ties - doubleLosses);
  const half = Math.round(decisive / 2);
  return { wins: half, losses: half, winRate: 50 };
}

/**
 * Rows for `label` from a single weighting profile of `matchupProfiles.json`.
 * Orients each pair so the current archetype is "us". Win rate is recomputed from
 * the weighted components (so it keeps the profile's quality weighting) valuing a
 * tie at {@link TIE_VALUE}: the file folds ties into `weightedWinsX` as 0.5, so the
 * weighted raw wins are `weightedWinsX − weightedTies/2`. Raw W/L for display is
 * recovered the same way from the unweighted counts.
 */
export function rowsFromMajorsProfile(profile: MatchupProfile, label: string): MatchupRowCore[] {
  const me = normalizeArchetypeKey(label);
  const out: MatchupRowCore[] = [];
  for (const pair of profile.byArchetypePair) {
    const keyA = normalizeArchetypeKey(pair.archetypeA);
    const keyB = normalizeArchetypeKey(pair.archetypeB);
    const isMirror = keyA === keyB;

    let usIsA: boolean;
    if (isMirror) {
      if (keyA !== me) {
        continue;
      }
      usIsA = true;
    } else if (keyA === me) {
      usIsA = true;
    } else if (keyB === me) {
      usIsA = false;
    } else {
      continue;
    }

    const opponentLabel = isMirror ? pair.archetypeA : usIsA ? pair.archetypeB : pair.archetypeA;

    if (isMirror) {
      out.push({
        opponentLabel,
        isMirror: true,
        ties: pair.ties,
        doubleLosses: pair.doubleLosses,
        matches: pair.matches,
        ...mirrorRecord(pair.matches, pair.ties, pair.doubleLosses)
      });
      continue;
    }

    const winsUs = usIsA ? pair.winsA : pair.winsB;
    const winsOpp = usIsA ? pair.winsB : pair.winsA;
    const weightedWinsUs = usIsA ? pair.weightedWinsA : pair.weightedWinsB;
    out.push({
      opponentLabel,
      isMirror: false,
      wins: Math.round(winsUs - pair.ties / 2),
      losses: Math.round(winsOpp - pair.ties / 2),
      ties: pair.ties,
      doubleLosses: pair.doubleLosses,
      matches: pair.matches,
      winRate: pointsWinRate(
        weightedWinsUs - pair.weightedTies / 2,
        pair.weightedTies,
        pair.weightedMatches || pair.matches
      )
    });
  }
  return out;
}

/**
 * Rows for `label` from the online meta's per-archetype matchups map. Recomputes
 * `winRate` from raw W/T (valuing a tie at {@link TIE_VALUE}) so it matches the
 * majors view; the stored `winRate` is the unweighted `wins/total`.
 */
export function rowsFromOnlineMatchups(matchups: Record<string, OnlineMatchupRecord>, label: string): MatchupRowCore[] {
  const me = normalizeArchetypeKey(label);
  const out: MatchupRowCore[] = [];
  for (const rec of Object.values(matchups)) {
    const isMirror = normalizeArchetypeKey(rec.opponent) === me;
    if (isMirror) {
      out.push({
        opponentLabel: rec.opponent,
        isMirror: true,
        ties: rec.ties,
        doubleLosses: 0,
        matches: rec.total,
        ...mirrorRecord(rec.total, rec.ties, 0)
      });
      continue;
    }
    out.push({
      opponentLabel: rec.opponent,
      isMirror: false,
      wins: rec.wins,
      losses: rec.losses,
      ties: rec.ties,
      doubleLosses: 0,
      matches: rec.total,
      winRate: pointsWinRate(rec.wins, rec.ties, rec.total)
    });
  }
  return out;
}
