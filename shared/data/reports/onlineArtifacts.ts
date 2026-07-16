/**
 * Online-window serving artifacts, built from decks via the shared builders.
 *
 * The online meta window (`reports/Online - Last 14 Days`) is produced by
 * `run-online-meta.ts`, which builds through the shared builders using the
 * same frozen online flavor exported here (preserve casing, 0.005 min-decks
 * fraction, fraction percent, deckCount sort, signature cards, thumbnails).
 * This module regenerates the derived artifacts — master, cardUsage, and the
 * archetype index — from an online window's captured decks without
 * re-fetching (`decks.json` + `meta.json` remain the source).
 * @module shared/data/reports/onlineArtifacts
 */

import { generateReportFromDecks, type LegacyCardReport } from './cardReport';
import { buildCardUsageIndex, type LegacyCardUsageIndex } from './cardUsage';
import { type ArchetypeDeckInput, buildArchetypeReports } from '../archetypes/build';
import type { SynonymDatabase } from '../cardIdentity';

export interface OnlineArtifactInputs {
  synonymDb: SynonymDatabase | null;
  cardTypesDb?: unknown;
  thumbnailConfig?: unknown;
}

export interface OnlineServingArtifacts {
  master: LegacyCardReport;
  cardUsage: LegacyCardUsageIndex;
  archetypeIndex: unknown;
}

/** The frozen online-flavor archetype build options (see archetype-presentation-parity test). */
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
    includeSignatureCards: true
  };
}

/**
 * Regenerate the online window's master/cardUsage/archetype-index from decks.
 * @param decks - The online window's aggregated decks (`decks.json`)
 * @param inputs - Synonym DB (online master IS synonym-canonicalized, D5), card
 *   types (thumbnail/signature inference), and the thumbnail override config
 * @returns The three derived serving artifacts
 */
export function buildOnlineServingArtifacts(
  decks: ArchetypeDeckInput[],
  inputs: OnlineArtifactInputs
): OnlineServingArtifacts {
  const master = generateReportFromDecks(decks as never, decks.length, inputs.synonymDb);
  const { files, index } = buildArchetypeReports(
    decks,
    inputs.synonymDb,
    onlineArchetypeOptions(inputs.thumbnailConfig, inputs.cardTypesDb, master)
  );
  const cardUsage = buildCardUsageIndex(files as never);
  return { master, cardUsage, archetypeIndex: index };
}
