/** Shared presentation options for the online-window producer. */

import { buildArchetypeReports } from '../archetypes/build';

/** The frozen online-flavor archetype build options. */
export function onlineArchetypeOptions(
  thumbnailConfig: unknown,
  cardTypesDb: unknown,
  masterReport: unknown
): Parameters<typeof buildArchetypeReports>[2] {
  return {
    nameCasing: 'preserve',
    minDecksFraction: 0.005,
    percentMode: 'fraction',
    sortMode: 'deckCount',
    thumbnailConfig: (thumbnailConfig ?? {}) as never,
    cardTypesDb,
    masterReport: masterReport as never,
    includeSignatureCards: true,
    excludeGenericGroups: true
  };
}
