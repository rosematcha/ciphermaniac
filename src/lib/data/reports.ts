/**
 * Tournament-scoped serving reports: the catalog, per-event metadata, and the
 * master card report.
 * @module src/lib/data/reports
 */

import { dataClient } from './client';
import { canonicalizeReportCached } from './compat';
import { ONLINE, tournamentPath } from './paths';
import { getSynonymDatabase } from '../../utils/cardSynonyms';
import type { CardItem, MetaReport } from '../../types';

const { fetchJson } = dataClient;

export interface MasterPayload {
  deckTotal: number;
  items: CardItem[];
  /**
   * Present only on "rolling canonical" artifacts: historical events whose
   * card-facing payloads were rebaked so card UIDs key by the event-date
   * canonical print (a variant UID from the same synonym cluster) instead of
   * today's global canonical. Its presence tells the read-time canonicalizer to
   * leave the items untouched — they're already build-time merged, and re-mapping
   * would rewrite the period-correct rolling print to the current global one.
   */
  canonicalizedAt?: string;
}

/**
 * Tournament list. Sorted by R2 already (recent first). Includes `ONLINE_META_NAME`
 * as the first entry in our wrapper, so the selector always offers the rolling meta.
 */
export async function fetchTournamentsList(): Promise<string[]> {
  const list = await fetchJson<string[]>('/reports/tournaments.json');
  // Make sure online meta is first if not already in the list.
  if (!list.includes(ONLINE)) {
    return [ONLINE, ...list];
  }
  return list;
}

export function fetchMeta(tournament: string = ONLINE): Promise<MetaReport> {
  return fetchJson<MetaReport>(`${tournamentPath(tournament)}/meta.json`);
}

export async function fetchMaster(tournament: string = ONLINE): Promise<MasterPayload> {
  const [raw, db] = await Promise.all([
    fetchJson<MasterPayload>(`${tournamentPath(tournament)}/master.json`),
    getSynonymDatabase()
  ]);
  return canonicalizeReportCached(raw, db);
}
