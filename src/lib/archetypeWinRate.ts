/**
 * Aggregate event win rate for an archetype: one number summarizing how it does
 * across the whole field. Built from the same normalized matchup rows the
 * MatchupsPanel renders (majors profiles or the online matchups map), so the hero
 * stat and the per-opponent table can never disagree about the source.
 *
 * The mirror is excluded (it is 50/50 by definition and would only drag every
 * archetype toward the mean). Ties are worth 1/3 of a win — the site convention
 * (Pokémon match points: win 3, tie 1, loss 0), matching `pointsWinRate`/`wrOf`.
 *
 * Kept free of Solid + DOM so the aggregation is unit-testable; the thin fetch
 * helpers below just wire it to the data layer.
 */
import { fetchArchetypeMatchupsOnline, fetchMatchupProfiles, type MatchupProfile, normalizeArchetypeKey } from './data';
import { type MatchupRowCore, pointsWinRate, rowsFromMajorsProfile, rowsFromOnlineMatchups } from './matchups';

/** Prefer the quality-weighted majors profile, falling back to the unweighted `all`. */
function pickMajorsProfile(profiles: Awaited<ReturnType<typeof fetchMatchupProfiles>>): MatchupProfile | undefined {
  return profiles?.profiles.qualityWeighted ?? profiles?.profiles.all;
}

/** Below this many games the aggregate is noise — render "—" instead of a number. */
export const WR_MIN_GAMES = 20;
/** Between {@link WR_MIN_GAMES} and this, show the number but visually mute it. */
export const WR_MUTE_GAMES = 50;

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
export function aggregateEventWinRate(rows: MatchupRowCore[]): WinRateAggregate {
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
    winRate: games > 0 ? pointsWinRate(wins, ties, games) : null
  };
}

/** Prefer the quality-weighted majors profile; the aggregate itself is raw W/L/T. */
async function fetchRowsForLabel(tournament: string, slug: string, label: string): Promise<MatchupRowCore[]> {
  const profiles = await fetchMatchupProfiles(tournament);
  const majorsProfile = pickMajorsProfile(profiles);
  if (majorsProfile) {
    return rowsFromMajorsProfile(majorsProfile, label);
  }
  const online = await fetchArchetypeMatchupsOnline(tournament, slug);
  return online ? rowsFromOnlineMatchups(online, label) : [];
}

/** One archetype's aggregate win rate (hero stat). */
export async function fetchArchetypeWinRate(
  tournament: string,
  slug: string,
  label: string
): Promise<WinRateAggregate> {
  return aggregateEventWinRate(await fetchRowsForLabel(tournament, slug, label));
}

/**
 * Every archetype's aggregate win rate, keyed by index `name` (slug).
 *
 * Majors ship one `matchupProfiles.json` with all pairs, so the whole table costs
 * a single request. The online meta has no such file — each archetype's record
 * lives in its own tiny `trends.json` — so that path fans out one small (CDN
 * cached) request per archetype. Callers gate this to the list view, where the
 * win-rate column is actually shown, to keep the request fan-out off the grid.
 */
export async function fetchAllArchetypeWinRates(
  tournament: string,
  entries: { name: string; label: string }[]
): Promise<Map<string, WinRateAggregate>> {
  const out = new Map<string, WinRateAggregate>();
  const profiles = await fetchMatchupProfiles(tournament);
  const majorsProfile = pickMajorsProfile(profiles);
  if (majorsProfile) {
    // One pass over the pair list accumulating raw W/L/T per archetype key, so
    // the whole table is O(pairs) instead of re-scanning every pair per entry.
    const byKey = new Map<string, { wins: number; losses: number; ties: number; games: number }>();
    const bump = (key: string, wins: number, losses: number, ties: number, games: number) => {
      const acc = byKey.get(key) ?? { wins: 0, losses: 0, ties: 0, games: 0 };
      acc.wins += wins;
      acc.losses += losses;
      acc.ties += ties;
      acc.games += games;
      byKey.set(key, acc);
    };
    for (const pair of majorsProfile.byArchetypePair) {
      const keyA = normalizeArchetypeKey(pair.archetypeA);
      const keyB = normalizeArchetypeKey(pair.archetypeB);
      if (keyA === keyB) {
        continue; // mirror: excluded from the aggregate by definition
      }
      const winsA = Math.round(pair.winsA - pair.ties / 2);
      const winsB = Math.round(pair.winsB - pair.ties / 2);
      bump(keyA, winsA, winsB, pair.ties, pair.matches);
      bump(keyB, winsB, winsA, pair.ties, pair.matches);
    }
    for (const e of entries) {
      const acc = byKey.get(normalizeArchetypeKey(e.label));
      out.set(
        e.name,
        acc
          ? { ...acc, winRate: acc.games > 0 ? pointsWinRate(acc.wins, acc.ties, acc.games) : null }
          : { wins: 0, losses: 0, ties: 0, games: 0, winRate: null }
      );
    }
    return out;
  }
  await Promise.all(
    entries.map(async e => {
      const online = await fetchArchetypeMatchupsOnline(tournament, e.name);
      out.set(e.name, aggregateEventWinRate(online ? rowsFromOnlineMatchups(online, e.label) : []));
    })
  );
  return out;
}
