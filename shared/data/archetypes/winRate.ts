/**
 * Normalizes an archetype name/label to the key form used by the icon override
 * map. Mirrors `normalize_deck_label` in download-tournament.py so the same key
 * matches both archetype `label`/`name` and trends `series.name` (the base slug,
 * e.g. "Dragapult Dusknoir" → "dragapult_dusknoir").
 */
export function normalizeArchetypeKey(name: string | null | undefined): string {
  return String(name ?? '')
    .replace(/['’]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

export interface WinRateAggregate {
  wins: number;
  losses: number;
  ties: number;
  /** Total recorded games (includes ties and double losses in the denominator). */
  games: number;
  /** 0..100 valuing a tie at 1/3, or null when there are no games. */
  winRate: number | null;
}

/**
 * Sum W/L/T and games across every non-mirror opponent, then compute a single
 * match-points win rate. `games` is the true denominator (ties and double losses
 * included), so `winRate = (Σwins + Σties/3) / Σgames`.
 */
export function aggregateEventWinRate(
  rows: { isMirror: boolean; wins: number; losses: number; ties: number; matches: number }[]
): WinRateAggregate {
  let wins = 0;
  let losses = 0;
  let ties = 0;
  let games = 0;
  for (const r of rows) {
    if (r.isMirror) {
      continue;
    }
    wins += r.wins;
    losses += r.losses;
    ties += r.ties;
    games += r.matches;
  }
  return {
    wins,
    losses,
    ties,
    games,
    winRate: games > 0 ? ((wins + ties * (1 / 3)) / games) * 100 : null
  };
}

/** Aggregate exactly the matchup rows published in the archetype's trends file. */
export function aggregateOnlineWinRate(
  matchups: Record<string, { opponent: string; wins: number; losses: number; ties: number; total: number }>,
  label: string
): WinRateAggregate {
  const key = normalizeArchetypeKey(label);
  return aggregateEventWinRate(
    Object.values(matchups).map(record => ({
      ...record,
      isMirror: normalizeArchetypeKey(record.opponent) === key,
      matches: record.total
    }))
  );
}
