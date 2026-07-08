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

export interface MatrixCell {
  /** 0..100 match-points win rate of the row archetype vs the column archetype. */
  winRate: number;
  matches: number;
  isMirror: boolean;
}

/**
 * Assemble an N×N head-to-head matrix keyed by normalized archetype key. Each
 * entry supplies its own already-normalized rows (from {@link rowsFromMajorsProfile}
 * or {@link rowsFromOnlineMatchups}); opponents outside the supplied key set are
 * dropped so the matrix stays square. Pure so it's unit-testable.
 */
export function buildMatchupMatrix(
  entries: { key: string; rows: MatchupRowCore[] }[]
): Map<string, Map<string, MatrixCell>> {
  const keySet = new Set(entries.map(e => e.key));
  const out = new Map<string, Map<string, MatrixCell>>();
  for (const entry of entries) {
    const cells = new Map<string, MatrixCell>();
    for (const row of entry.rows) {
      const oppKey = normalizeArchetypeKey(row.opponentLabel);
      if (!keySet.has(oppKey)) {
        continue;
      }
      cells.set(oppKey, { winRate: row.winRate, matches: row.matches, isMirror: row.isMirror });
    }
    out.set(entry.key, cells);
  }
  return out;
}

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
 * Gauge fill as a percentage (0..100) of the track: the deviation |WR − 50|
 * scaled so ±50pp fills the whole track. Even matchups fill nothing.
 */
export function gaugeWidth(winRate: number): number {
  const dev = Math.abs(winRate - 50);
  return Math.max(0, Math.min(100, (dev / 50) * 100));
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
  let best: { label: string; winRate: number } | null = null;
  let toughest: { label: string; winRate: number } | null = null;
  let tracked = 0;
  for (const r of rows) {
    if (r.matches < minGames) {
      continue;
    }
    tracked += 1;
    const bucket = bucketWinRate(r.winRate);
    if (bucket === 'fav') {
      favored += 1;
    } else if (bucket === 'even') {
      even += 1;
    } else {
      unfavored += 1;
    }
    if (!best || r.winRate > best.winRate) {
      best = { label: r.opponentLabel, winRate: r.winRate };
    }
    if (!toughest || r.winRate < toughest.winRate) {
      toughest = { label: r.opponentLabel, winRate: r.winRate };
    }
  }
  return { favored, even, unfavored, tracked, best, toughest };
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
