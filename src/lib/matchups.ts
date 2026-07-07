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
