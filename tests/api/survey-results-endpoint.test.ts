/* eslint-disable camelcase -- mock rows mirror the survey D1 table's snake_case column names */
import test from 'node:test';
import assert from 'node:assert/strict';

import { onRequestGet } from '../../functions/api/survey/results.ts';

function mockDb(rows: Record<string, unknown>[]) {
  return {
    prepare() {
      return {
        bind() {
          return this;
        },
        async all() {
          return { results: rows };
        }
      };
    }
  };
}

// --- P-42: a malformed JSON column must not 500 the whole route ---

test('survey results survives malformed JSON rows (object where array expected)', async () => {
  const rows = [
    {
      created_at: '2026-07-01T00:00:00Z',
      region: 'NA',
      // Should be a string[]; a parsed object would throw a for...of on older code.
      devices_json: '{"desktop": 1}',
      formats_json: '"standard"', // parses to a string, not an array
      areas_json: '42', // parses to a number
      // Rating maps: an array where a Record was expected.
      readability_json: '[1,2,3]',
      effectiveness_json: 'not valid json',
      layout_json: '{"cards": 5}', // this one is well-formed
      speed: 4,
      trust: 5,
      recommend: 9,
      discovery: 'search',
      feature_text: 'more filters',
      annoyance_text: null,
      anything_else: null
    },
    {
      created_at: '2026-07-02T00:00:00Z',
      region: 'EU',
      devices_json: '["mobile","tablet"]', // well-formed
      formats_json: '["standard"]',
      areas_json: '["cards"]',
      readability_json: '{"clarity": 4}',
      effectiveness_json: null,
      layout_json: null,
      speed: 3,
      trust: 4,
      recommend: 2,
      discovery: 'friend',
      feature_text: null,
      annoyance_text: 'slow',
      anything_else: 'thanks'
    }
  ];

  const env = { SURVEY_DB: mockDb(rows) } as never;
  const res = await onRequestGet({ env });
  assert.strictEqual(res.status, 200);
  const body = (await res.json()) as {
    total: number;
    devices: Record<string, number>;
    layout: Record<string, unknown>;
  };
  assert.strictEqual(body.total, 2);
  // Well-formed values still aggregate correctly.
  assert.strictEqual(body.devices.mobile, 1);
  assert.strictEqual(body.devices.tablet, 1);
  // The malformed rating maps were skipped; the well-formed one folded in.
  assert.ok(body.layout.cards);
});

test('survey results returns 503 when storage is unavailable', async () => {
  const res = await onRequestGet({ env: {} as never });
  assert.strictEqual(res.status, 503);
});
