/**
 * Lays one synonym build over the previous database.
 * @module .github/scripts/lib/synonymMerge
 */

import type { SynonymDatabase } from '../../../shared/data/cardIdentity';

type SynonymMaps = Required<Pick<SynonymDatabase, 'synonyms' | 'canonicals' | 'prints'>>;

/**
 * Merge this run's mappings over the previous database's. Any card re-clustered
 * this run overrides its old entry, while mappings whose source was missing
 * this run are kept rather than dropped (P-06).
 *
 * A print this run made canonical also loses its old outgoing edge. Kept, that
 * edge forms a cycle with the fresh one, and in a two-print cluster
 * (Dark Tyranitar TRR 019 and 30C CC9) the flatten step breaks the tie by UID
 * order rather than by this run's choice.
 * @param fresh - This run's mappings
 * @param previous - The published database
 */
export function mergeSynonymMaps(fresh: SynonymMaps, previous: Partial<SynonymMaps>): SynonymMaps {
  const freshCanonicals = new Set([...Object.values(fresh.synonyms), ...Object.values(fresh.canonicals)]);
  const kept = Object.entries(previous.synonyms ?? {}).filter(([uid]) => !freshCanonicals.has(uid));
  return {
    synonyms: { ...Object.fromEntries(kept), ...fresh.synonyms },
    canonicals: { ...previous.canonicals, ...fresh.canonicals },
    prints: { ...previous.prints, ...fresh.prints }
  };
}
