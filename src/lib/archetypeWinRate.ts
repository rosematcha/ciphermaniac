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
import { aggregateEventWinRate, type WinRateAggregate } from '../../shared/data/archetypes/winRate';
import { ONLINE_META_NAME } from './constants';
import type { ArchetypeIndexEntry } from '../types';
export { aggregateEventWinRate, type WinRateAggregate } from '../../shared/data/archetypes/winRate';

import { type MatchupRowCore, pointsWinRate, rowsFromMajorsProfile, rowsFromOnlineMatchups } from './matchups';

/** Prefer the quality-weighted majors profile, falling back to the unweighted `all`. */
function pickMajorsProfile(profiles: Awaited<ReturnType<typeof fetchMatchupProfiles>>): MatchupProfile | undefined {
  return profiles?.profiles.qualityWeighted ?? profiles?.profiles.all;
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

/** Index aggregates require no extra downloads; legacy majors use one shared profile. */
export async function fetchAllArchetypeWinRates(
  tournament: string,
  entries: Pick<ArchetypeIndexEntry, 'name' | 'label' | 'winRateAggregate'>[]
): Promise<Map<string, WinRateAggregate>> {
  const out = new Map<string, WinRateAggregate>();
  for (const entry of entries) {
    out.set(entry.name, entry.winRateAggregate ?? aggregateEventWinRate([]));
  }
  if (tournament === ONLINE_META_NAME || entries.every(entry => entry.winRateAggregate !== undefined)) {
    return out;
  }
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
  return out;
}
