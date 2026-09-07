import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCardSynonyms } from '../../shared/data/cardSynonyms';
import { loadCardTypesDatabase } from '../../shared/data/cardTypesDatabase';
import { EMPTY_DATABASE } from '../../shared/data/cardIdentity';

test('metadata loaders return safe fallbacks for Error and non-Error failures', async () => {
  for (const failure of [new Error('offline'), 'unavailable']) {
    const bucket = {
      get: async () => {
        throw failure;
      }
    };
    assert.deepEqual(await loadCardTypesDatabase({ REPORTS: bucket }), {});
    assert.deepEqual(await loadCardSynonyms({ REPORTS: bucket as unknown as R2Bucket }), EMPTY_DATABASE);
  }
});
