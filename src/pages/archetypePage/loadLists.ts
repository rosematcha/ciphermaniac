/**
 * Loads every published list of one archetype for the Lists tab. The online
 * scope merges the rolling window with the majors of the last month, so the
 * tab shows in-person results beside online ones; an event scope shows that
 * event alone. Sources without a list index (snapshots, events built before
 * `lists.json`) contribute nothing rather than failing the tab.
 */
import { fetchTournamentsList } from '../../lib/data/reports';
import { decodeListIndex, fetchListIndex } from '../../lib/data/lists';
import { ONLINE } from '../../lib/data/paths';
import { getSynonymDatabase } from '../../utils/cardSynonyms';
import { classifyTournament } from '../../../shared/data/tournamentKeys';
import { normalizeArchetypeName } from '../../../shared/cardUtils';
import type { ArchetypeList, Venue } from './listsModel';

/** How far back the online scope reaches for majors. */
export const RECENT_MAJOR_DAYS = 30;
const DAY_MS = 86_400_000;

/**
 * Event folders dated within `days` of `now`. Folder keys lead with their
 * start date ("2026-09-18, Regional Championship Baltimore").
 */
export function recentMajors(keys: readonly string[], now: number, days = RECENT_MAJOR_DAYS): string[] {
  return keys.filter(key => {
    if (classifyTournament(key) === 'online') {
      return false;
    }
    const start = Date.parse(`${key.slice(0, 10)}T00:00:00Z`);
    return Number.isFinite(start) && now - start <= days * DAY_MS && start <= now;
  });
}

interface Source {
  tournament: string;
  venue: Venue;
}

async function sourcesFor(tournament: string): Promise<Source[]> {
  if (tournament !== ONLINE) {
    return [{ tournament, venue: 'live' }];
  }
  const keys = await fetchTournamentsList().catch(() => [] as string[]);
  return [
    { tournament: ONLINE, venue: 'online' },
    ...recentMajors(keys, Date.now()).map(key => ({ tournament: key, venue: 'live' as const }))
  ];
}

/**
 * Every list of the archetype across the scope's sources.
 * @param tournament - The scope (the online key or an event folder)
 * @param names - The archetype's slug and label; a list matches either
 */
export async function fetchArchetypeLists(tournament: string, names: readonly string[]): Promise<ArchetypeList[]> {
  const wanted = new Set(names.map(normalizeArchetypeName));
  const [sources, db] = await Promise.all([sourcesFor(tournament), getSynonymDatabase().catch(() => null)]);
  const payloads = await Promise.all(sources.map(s => fetchListIndex(s.tournament).catch(() => null)));
  return sources.flatMap((source, i) => {
    const payload = payloads[i];
    if (!payload) {
      return [];
    }
    return decodeListIndex(payload, db)
      .filter(record => wanted.has(normalizeArchetypeName(record.archetype)))
      .map(record => ({ key: `${i}:${record.id}`, record, venue: source.venue }));
  });
}
