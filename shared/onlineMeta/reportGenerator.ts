/** Functions-snapshot adapter for the shared archetype builder. */
import {
  buildArchetypeReports as buildArchetypeReportsShared,
  type ArchetypeDeckInput as SharedArchetypeDeckInput
} from '../data/archetypes/build';
import type { SynonymDatabase } from '../data/cardIdentity';
import type { LegacyCardReport } from '../data/reports/cardReport';
import archetypeThumbnails from '../../public/assets/data/archetype-thumbnails.json';
import type { BuildArchetypeReportsOptions, CardEntryInput, ThumbnailConfig } from './types';

/**
 * Loose deck input accepted by buildArchetypeReports. Production decks are
 * `GatheredDeck`, but test fixtures may provide only a subset of fields.
 */
interface ArchetypeDeckInput {
  archetype?: string;
  cards?: CardEntryInput[];
}

const ARCHETYPE_THUMBNAILS: ThumbnailConfig = (archetypeThumbnails as ThumbnailConfig) || {};

export function buildArchetypeReports(
  decks: ArchetypeDeckInput[],
  minPercent: number,
  synonymDb: unknown,
  options: BuildArchetypeReportsOptions = {}
) {
  const result = buildArchetypeReportsShared(decks as SharedArchetypeDeckInput[], synonymDb as SynonymDatabase | null, {
    nameCasing: 'lower',
    minDecksFraction: minPercent / 100,
    percentMode: 'fraction',
    sortMode: 'deckCount',
    thumbnailConfig: options.thumbnailConfig || {},
    includeSignatureCards: false
  });

  const archetypeFiles: Array<{
    filename: string;
    base: string;
    displayName: string;
    data: LegacyCardReport;
    deckCount: number;
  }> = result.files.map(file => ({
    filename: `${file.base}.json`,
    base: file.base,
    displayName: file.displayName,
    data: file.data,
    deckCount: file.deckCount
  }));

  return {
    archetypeFiles,
    archetypeIndex: result.index,
    minDecks: result.minDecks,
    deckMap: result.decksByBase
  };
}

export { ARCHETYPE_THUMBNAILS };
