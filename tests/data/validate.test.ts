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

test('isRecord accepts plain objects and rejects the object-like values', () => {
  assert.ok(isRecord({}));
  assert.ok(isRecord({ a: 1 }));
  assert.ok(!isRecord(null));
  assert.ok(!isRecord([]));
  assert.ok(!isRecord('x'));
  assert.ok(!isRecord(undefined));
});

test('isInteger rejects the non-integer numbers', () => {
  assert.ok(isInteger(0));
  assert.ok(isInteger(-4));
  assert.ok(!isInteger(1.5));
  assert.ok(!isInteger(NaN));
  assert.ok(!isInteger(Infinity));
  assert.ok(!isInteger('3'));
});

test('isNonEmptyString requires at least one character', () => {
  assert.ok(isNonEmptyString('a'));
  assert.ok(!isNonEmptyString(''));
  assert.ok(!isNonEmptyString(null));
});

test('isStringArray accepts an empty array but not a mixed one', () => {
  assert.ok(isStringArray([]));
  assert.ok(isStringArray(['a', 'b']));
  assert.ok(!isStringArray(['a', 1]));
  assert.ok(!isStringArray('a'));
});

test('isIntegerAtLeast is inclusive of its bound', () => {
  const atLeastOne = isIntegerAtLeast(1);
  assert.ok(atLeastOne(1));
  assert.ok(atLeastOne(9));
  assert.ok(!atLeastOne(0));
  assert.ok(!atLeastOne(1.5));
});

test('isFiniteInRange is inclusive at both ends and rejects non-finite values', () => {
  const pct = isFiniteInRange(0, 100);
  assert.ok(pct(0));
  assert.ok(pct(100));
  assert.ok(!pct(-0.1));
  assert.ok(!pct(100.1));
  assert.ok(!pct(NaN));
  assert.ok(!pct(Infinity));
});

test('isMemberOf works from an array or a set, and non-strings fail rather than throw', () => {
  const fromArray = isMemberOf(['a', 'b']);
  const fromSet = isMemberOf(new Set(['a', 'b']));
  assert.ok(fromArray('a'));
  assert.ok(fromSet('b'));
  assert.ok(!fromArray('c'));
  assert.ok(!fromSet(null));
  assert.ok(!fromArray(1));
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

test('an empty path yields unprefixed field names', () => {
  const errors: string[] = [];
  checkFields(
    { metadataVersion: 0 },
    '',
    { metadataVersion: required(isIntegerAtLeast(1), 'expected positive integer') },
    errors
  );
  assert.deepEqual(errors, ['metadataVersion: expected positive integer']);
});

test('a nested path is joined with a dot', () => {
  const errors: string[] = [];
  checkFields(
    { wins: -1 },
    'participants[3].record',
    { wins: required(isIntegerAtLeast(0), 'expected a non-negative integer') },
    errors
  );
  assert.deepEqual(errors, ['participants[3].record.wins: expected a non-negative integer']);
});

// ============================================================================
// Collection behaviour
// ============================================================================

test('every failing field is reported, in spec order, with no short circuit', () => {
  const errors: string[] = [];
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
  assert.deepEqual(errors, ['root.a: expected string a', 'root.b: expected string b']);
});

test('checkFields appends rather than replacing prior errors', () => {
  const errors = ['earlier: something else'];
  checkFields({}, 'root', { name: required(isNonEmptyString, 'expected non-empty string') }, errors);
  assert.deepEqual(errors, ['earlier: something else', 'root.name: expected non-empty string']);
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

test('a bad element is reported by index', () => {
  const errors: string[] = [];
  checkArrayOf(
    ['ok', '', 'fine', 7],
    'root.icons',
    'expected an array of non-empty strings',
    required(isNonEmptyString, 'expected a non-empty string'),
    errors
  );
  assert.deepEqual(errors, [
    'root.icons[1]: expected a non-empty string',
    'root.icons[3]: expected a non-empty string'
  ]);
});

test('an empty array passes', () => {
  const errors: string[] = [];
  checkArrayOf(
    [],
    'root.icons',
    'expected an array',
    required(isNonEmptyString, 'expected a non-empty string'),
    errors
  );
  assert.deepEqual(errors, []);
});

// ============================================================================
// Value-derived messages
// ============================================================================

test('a function message tail is resolved against the value that failed', () => {
  const errors: string[] = [];
  checkFields(
    { outcome: 'nope' },
    'matches[0]',
    { outcome: required(isMemberOf(['decided', 'tie']), v => `invalid outcome "${String(v)}"`) },
    errors
  );
  assert.deepEqual(errors, ['matches[0].outcome: invalid outcome "nope"']);
});

test('a function message tail also resolves for array elements, per element', () => {
  const errors: string[] = [];
  checkArrayOf(
    ['ok', 'bad'],
    'root.tags',
    'expected array',
    required(isMemberOf(['ok']), v => `unknown value "${String(v)}"`),
    errors
  );
  assert.deepEqual(errors, ['root.tags[1]: unknown value "bad"']);
});
