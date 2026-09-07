import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forbiddenGeneratedFiles } from '../../scripts/quality/generated-files.mjs';

test('rejects force-added output while allowing synthetic fixtures and configuration', () => {
  const forbidden = [
    '.cache/data.json',
    'dist/index.html',
    'src/data/archetype-icons.json',
    'public/assets/card-synonyms.json'
  ];
  assert.deepEqual(
    forbiddenGeneratedFiles([
      ...forbidden,
      'tests/fixtures/e2e/assets/archetype-icons.json',
      'config/quality/bundle-budgets.json'
    ]),
    forbidden
  );
});
