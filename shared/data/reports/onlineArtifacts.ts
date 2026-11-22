/** Shared presentation options for the online-window producer. */

import type { ArchetypePages } from '../../formats/registry';
import { buildArchetypeReports } from '../archetypes/build';

/** The online-flavor archetype build options; `pages` replaces the 0.5% floor. */
export function onlineArchetypeOptions(
  thumbnailConfig: unknown,
  cardTypesDb: unknown,
  masterReport: unknown,
  pages?: ArchetypePages
): Parameters<typeof buildArchetypeReports>[2] {
  return {
    nameCasing: 'preserve',
    minDecksFraction: 0.005,
    ...(pages ? { minDecks: pages.minDecks, maxArchetypes: pages.max } : {}),
    percentMode: 'fraction',
    sortMode: 'deckCount',
    thumbnailConfig: (thumbnailConfig ?? {}) as never,
    cardTypesDb,
    masterReport: masterReport as never,
    includeSignatureCards: true,
    excludeGenericGroups: true
  };
}
