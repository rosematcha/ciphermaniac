/** The hand-picked format thumbnails name real prints of known formats. */

import assert from 'node:assert/strict';
import test from 'node:test';

import formatThumbnails from '../../config/archetypes/format-thumbnails.json' with { type: 'json' };
import { getReleaseIndex } from '../../shared/data/canonicalPrint.ts';
import { FORMAT_SCOPES } from '../../shared/formats/registry.ts';

test('every format thumbnail is a SET/NNN id in a catalogued set of a known format', () => {
  for (const [format, archetypes] of Object.entries(formatThumbnails as Record<string, Record<string, string[]>>)) {
    assert.ok(
      FORMAT_SCOPES.some(scope => scope.id === format),
      `${format} is a format`
    );
    for (const [label, ids] of Object.entries(archetypes)) {
      assert.ok(ids.length > 0, `${format} ${label} has thumbnails`);
      for (const id of ids) {
        const match = /^([A-Z0-9]+)\/(\d{3})$/.exec(id);
        assert.ok(match && getReleaseIndex(match[1]) >= 0, `${format} ${label}: ${id}`);
      }
    }
  }
});
