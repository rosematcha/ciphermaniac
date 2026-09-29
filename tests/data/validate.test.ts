/**
 * tests/data/validate.test.ts
 * Unit tests for the declarative field-validation runner that contracts.ts and
 * artifacts.ts are built on. The runner's job is narrow — apply a table of
 * rules, collect every failure, and format the message exactly — so these tests
 * pin the three things the callers depend on: presence semantics, message
 * formatting (including the unprefixed root case), and that nothing short
 * circuits on the first failure.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  checkArrayOf,
  checkFields,
  isFiniteInRange,
  isInteger,
  isIntegerAtLeast,
  isMemberOf,
  isNonEmptyString,
  isRecord,
  isStringArray,
  orNull,
  required,
  whenPresent
} from '../../shared/data/validate.ts';

// ============================================================================
// Predicates
// ============================================================================

test('each predicate accepts exactly its values and fails rather than throws on the rest', () => {
  const atLeastOne = isIntegerAtLeast(1);
  const pct = isFiniteInRange(0, 100);
  const cases: Array<[string, (value: unknown) => boolean, unknown[], unknown[]]> = [
    ['isRecord', isRecord, [{}, { a: 1 }], [null, [], 'x', undefined]],
    ['isInteger', isInteger, [0, -4], [1.5, NaN, Infinity, '3']],
    ['isNonEmptyString', isNonEmptyString, ['a'], ['', null]],
    ['isStringArray', isStringArray, [[], ['a', 'b']], [['a', 1], 'a']],
    // Inclusive of its bound.
    ['isIntegerAtLeast(1)', atLeastOne, [1, 9], [0, 1.5]],
    // Inclusive at both ends.
    ['isFiniteInRange(0, 100)', pct, [0, 100], [-0.1, 100.1, NaN, Infinity]],
    ['isMemberOf(array)', isMemberOf(['a', 'b']), ['a'], ['c', 1]],
    ['isMemberOf(set)', isMemberOf(new Set(['a', 'b'])), ['b'], [null]]
  ];
  for (const [name, predicate, accepted, rejected] of cases) {
    for (const value of accepted) {
      assert.ok(predicate(value), `${name} accepts ${JSON.stringify(value)}`);
    }
    for (const value of rejected) {
      assert.ok(!predicate(value), `${name} rejects ${String(value)}`);
    }
  }
});

// ============================================================================
// Presence semantics
// ============================================================================

test('required checks absent values rather than skipping them', () => {
  const errors: string[] = [];
  checkFields({}, 'root', { name: required(isNonEmptyString, 'expected non-empty string') }, errors);
  assert.deepEqual(errors, ['root.name: expected non-empty string']);
});

test('whenPresent skips undefined but still rejects an explicit null', () => {
  const absent: string[] = [];
  checkFields({}, 'root', { hp: whenPresent(isIntegerAtLeast(1), 'expected positive integer') }, absent);
  assert.deepEqual(absent, []);

  const explicitNull: string[] = [];
  checkFields(
    { hp: null },
    'root',
    { hp: whenPresent(isIntegerAtLeast(1), 'expected positive integer') },
    explicitNull
  );
  assert.deepEqual(explicitNull, ['root.hp: expected positive integer']);
});

test('orNull skips both undefined and null', () => {
  const rule = { points: orNull(isIntegerAtLeast(0), 'expected a non-negative integer or null') };
  for (const record of [{}, { points: null }, { points: undefined }]) {
    const errors: string[] = [];
    checkFields(record, 'root', rule, errors);
    assert.deepEqual(errors, [], `expected no error for ${JSON.stringify(record)}`);
  }

  const bad: string[] = [];
  checkFields({ points: -1 }, 'root', rule, bad);
  assert.deepEqual(bad, ['root.points: expected a non-negative integer or null']);
});

// ============================================================================
// Message formatting
// ============================================================================

test('a nested path is joined with a dot, and an empty path yields unprefixed field names', () => {
  const errors: string[] = [];
  checkFields(
    { wins: -1 },
    'participants[3].record',
    { wins: required(isIntegerAtLeast(0), 'expected a non-negative integer') },
    errors
  );
  checkFields(
    { metadataVersion: 0 },
    '',
    { metadataVersion: required(isIntegerAtLeast(1), 'expected positive integer') },
    errors
  );
  assert.deepEqual(errors, [
    'participants[3].record.wins: expected a non-negative integer',
    'metadataVersion: expected positive integer'
  ]);
});

// ============================================================================
// Collection behaviour
// ============================================================================

test('every failing field is appended to prior errors, in spec order, with no short circuit', () => {
  const errors = ['earlier: something else'];
  checkFields(
    { a: 1, b: 2, c: 'ok' },
    'root',
    {
      a: required(isNonEmptyString, 'expected string a'),
      b: required(isNonEmptyString, 'expected string b'),
      c: required(isNonEmptyString, 'expected string c')
    },
    errors
  );
  assert.deepEqual(errors, ['earlier: something else', 'root.a: expected string a', 'root.b: expected string b']);
});

// ============================================================================
// checkArrayOf
// ============================================================================

test('a non-array reports the array itself, not its elements', () => {
  const errors: string[] = [];
  checkArrayOf(
    'nope',
    'root.icons',
    'expected an array of non-empty strings',
    required(isNonEmptyString, 'expected a non-empty string'),
    errors
  );
  assert.deepEqual(errors, ['root.icons: expected an array of non-empty strings']);
});

test('a bad element is reported by index, and an empty array passes', () => {
  const errors: string[] = [];
  const element = required(isNonEmptyString, 'expected a non-empty string');
  checkArrayOf(['ok', '', 'fine', 7], 'root.icons', 'expected an array of non-empty strings', element, errors);
  checkArrayOf([], 'root.empty', 'expected an array', element, errors);
  assert.deepEqual(errors, [
    'root.icons[1]: expected a non-empty string',
    'root.icons[3]: expected a non-empty string'
  ]);
});

// ============================================================================
// Value-derived messages
// ============================================================================

test('a function message tail is resolved against the value that failed, per array element too', () => {
  const errors: string[] = [];
  checkFields(
    { outcome: 'nope' },
    'matches[0]',
    { outcome: required(isMemberOf(['decided', 'tie']), v => `invalid outcome "${String(v)}"`) },
    errors
  );
  checkArrayOf(
    ['ok', 'bad'],
    'root.tags',
    'expected array',
    required(isMemberOf(['ok']), v => `unknown value "${String(v)}"`),
    errors
  );
  assert.deepEqual(errors, ['matches[0].outcome: invalid outcome "nope"', 'root.tags[1]: unknown value "bad"']);
});
