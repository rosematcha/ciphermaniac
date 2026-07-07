/**
 * Fetch + assemble the meta-wide head-to-head matrix for a scope, reusing the
 * same normalized rows the per-archetype MatchupsPanel renders so a cell and the
 * archetype's own matchups tab can never disagree.
 *
 * Majors ship one `matchupProfiles.json` with every pair, so the whole matrix is
 * a single request. The online meta has no such file — each archetype's record
 * lives in its own tiny `trends.json` — so that path fans out one small (CDN
 * cached) request per archetype, matching `fetchAllArchetypeWinRates`.
 */
import { fetchArchetypeMatchupsOnline, fetchMatchupProfiles, normalizeArchetypeKey } from './data';
import {
  buildMatchupMatrix,
  type MatchupRowCore,
  type MatrixCell,
  rowsFromMajorsProfile,
  rowsFromOnlineMatchups
} from './matchups';

export interface MatrixEntry {
  /** Index `name` (route slug). */
  name: string;
  label: string;
  /** Normalized key used to index into the matrix. */
  key: string;
}

export interface MatchupMatrix {
  entries: MatrixEntry[];
  cells: Map<string, Map<string, MatrixCell>>;
}

/** Build the matrix for the given ordered archetypes (already sorted by the caller). */
export async function fetchMatchupMatrix(
  tournament: string,
  archetypes: { name: string; label: string }[]
): Promise<MatchupMatrix> {
  const entries: MatrixEntry[] = archetypes.map(a => ({
    name: a.name,
    label: a.label,
    key: normalizeArchetypeKey(a.label)
  }));

  const profiles = await fetchMatchupProfiles(tournament);
  const majorsProfile = profiles?.profiles.qualityWeighted ?? profiles?.profiles.all;

  let rowsByEntry: { key: string; rows: MatchupRowCore[] }[];
  if (majorsProfile) {
    rowsByEntry = entries.map(e => ({ key: e.key, rows: rowsFromMajorsProfile(majorsProfile, e.label) }));
  } else {
    rowsByEntry = await Promise.all(
      entries.map(async e => {
        const online = await fetchArchetypeMatchupsOnline(tournament, e.name);
        return { key: e.key, rows: online ? rowsFromOnlineMatchups(online, e.label) : [] };
      })
    );
  }

  return { entries, cells: buildMatchupMatrix(rowsByEntry) };
}
