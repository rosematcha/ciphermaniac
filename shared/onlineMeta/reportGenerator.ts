/**
 * Archetype report generation for Functions snapshots — now a thin wrapper
 * around the consolidated archetype builder in `shared/data/archetypes/`
 * (DB-MASTER-PLAN Phase 2, slice 5).
 *
 * The previous local implementation carried a STALE copy of the thumbnail
 * engine (stage-1 name inference only, gated at 99.9% usage) that predated the
 * online pipeline's three-stage engine. Per the plan's "Archetype presentation"
 * authority row it retires here: snapshots now resolve thumbnails through the
 * shared engine (30% stage-1 gate plus ability/attack and distinctiveness
 * stages). Recorded output difference (Functions-only path): archetypes without
 * a config override that previously got `[]` thumbnails can now get inferred
 * ones; override-config hits are unchanged.
 *
 * Everything else about this producer's shape is preserved exactly: lowercased
 * group keys and slug bases (the D3 quirk), fraction `percent`, deckCount-desc
 * ordering, `${base}.json` filenames, and NO `signatureCards`/`icons` fields on
 * index entries.
 */
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
