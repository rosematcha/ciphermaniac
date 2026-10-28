/**
 * Merging a synonym build over the published database, then flattening it the
 * way update-card-synonyms.mjs does.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeSynonymMaps } from '../../.github/scripts/lib/synonymMerge.ts';
import { normalizeSynonymDatabase } from '../../shared/data/cardIdentity.ts';

function mergeAndFlatten(fresh: Record<string, string>, previous: Record<string, string>): Record<string, string> {
  const merged = mergeSynonymMaps(
    { synonyms: fresh, canonicals: {}, prints: {} },
    { synonyms: previous, canonicals: {}, prints: {} }
  );
  return normalizeSynonymDatabase(merged).synonyms;
}

test("a two-print cluster flips to this run's canonical", () => {
  // The CC rule moved Dark Tyranitar off its 30C Classic Collection print.
  assert.deepEqual(
    mergeAndFlatten(
      { 'Dark Tyranitar::30C::CC9': 'Dark Tyranitar::TRR::019' },
      { 'Dark Tyranitar::TRR::019': 'Dark Tyranitar::30C::CC9' }
    ),
    { 'Dark Tyranitar::30C::CC9': 'Dark Tyranitar::TRR::019' }
  );
});

test('mappings this run never saw are kept', () => {
  assert.deepEqual(
    mergeAndFlatten(
      { 'Iono::PAL::185': 'Iono::SVP::124' },
      { 'Iono::PAL::185': 'Iono::SVP::124', 'Arven::OBF::186': 'Arven::SVI::166' }
    ),
    { 'Iono::PAL::185': 'Iono::SVP::124', 'Arven::OBF::186': 'Arven::SVI::166' }
  );
});

test('names, prints and fresh name canonicals merge over the previous ones', () => {
  const merged = mergeSynonymMaps(
    { synonyms: {}, canonicals: { Iono: 'Iono::PAL::185' }, prints: { 'Iono::PAL::185': 0.29 } },
    {
      synonyms: { 'Iono::PAL::185': 'Iono::SVP::124' },
      canonicals: { Iono: 'Iono::SVP::124', Arven: 'Arven::SVI::166' },
      prints: { 'Iono::PAL::185': 0.31, 'Arven::SVI::166': 0.2 }
    }
  );
  assert.deepEqual(merged, {
    synonyms: {},
    canonicals: { Iono: 'Iono::PAL::185', Arven: 'Arven::SVI::166' },
    prints: { 'Iono::PAL::185': 0.29, 'Arven::SVI::166': 0.2 }
  });
});
