/**
 * tests/shared/cardUtils.test.ts
 * Tests for shared/cardUtils.ts - card utility functions used across frontend and backend
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCardIdentifier,
  canonicalizeVariant,
  normalizeArchetypeName,
  normalizeCardNumber,
  sanitizeForFilename,
  sanitizeForPath
} from '../../shared/cardUtils.js';

// ============================================================================
// normalizeCardNumber tests
// ============================================================================

test('normalizeCardNumber pads single digit to 3 digits', () => {
  assert.strictEqual(normalizeCardNumber('5'), '005');
  assert.strictEqual(normalizeCardNumber('1'), '001');
  assert.strictEqual(normalizeCardNumber('9'), '009');
});

test('normalizeCardNumber pads double digits to 3 digits', () => {
  assert.strictEqual(normalizeCardNumber('18'), '018');
  assert.strictEqual(normalizeCardNumber('42'), '042');
  assert.strictEqual(normalizeCardNumber('99'), '099');
});

test('normalizeCardNumber preserves 3-digit numbers', () => {
  assert.strictEqual(normalizeCardNumber('118'), '118');
  assert.strictEqual(normalizeCardNumber('001'), '001');
  assert.strictEqual(normalizeCardNumber('999'), '999');
});

test('normalizeCardNumber handles numbers with letter suffix', () => {
  assert.strictEqual(normalizeCardNumber('18a'), '018A');
  assert.strictEqual(normalizeCardNumber('5b'), '005B');
  assert.strictEqual(normalizeCardNumber('118a'), '118A');
});

test('normalizeCardNumber uppercases letter suffix', () => {
  assert.strictEqual(normalizeCardNumber('18A'), '018A');
  assert.strictEqual(normalizeCardNumber('18a'), '018A');
  assert.strictEqual(normalizeCardNumber('5gg'), '005GG');
});

test('normalizeCardNumber handles non-numeric prefixes (like GG05)', () => {
  assert.strictEqual(normalizeCardNumber('GG05'), 'GG05');
  assert.strictEqual(normalizeCardNumber('gg05'), 'GG05');
  assert.strictEqual(normalizeCardNumber('SV01'), 'SV01');
  assert.strictEqual(normalizeCardNumber('TG15'), 'TG15');
});

test('normalizeCardNumber returns empty string for null/undefined', () => {
  assert.strictEqual(normalizeCardNumber(null), '');
  assert.strictEqual(normalizeCardNumber(undefined), '');
});

test('normalizeCardNumber returns empty string for empty input', () => {
  assert.strictEqual(normalizeCardNumber(''), '');
  assert.strictEqual(normalizeCardNumber('   '), '');
});

test('normalizeCardNumber trims whitespace', () => {
  assert.strictEqual(normalizeCardNumber('  5  '), '005');
  assert.strictEqual(normalizeCardNumber('\t18\n'), '018');
});

test('normalizeCardNumber handles numeric input', () => {
  assert.strictEqual(normalizeCardNumber(5), '005');
  assert.strictEqual(normalizeCardNumber(118), '118');
  assert.strictEqual(normalizeCardNumber(42), '042');
});

// ============================================================================
// canonicalizeVariant tests
// ============================================================================

test('canonicalizeVariant returns uppercased set code and normalized number', () => {
  assert.deepStrictEqual(canonicalizeVariant('svi', '118'), ['SVI', '118']);
  assert.deepStrictEqual(canonicalizeVariant('Paldea', '5'), ['PALDEA', '005']);
  assert.deepStrictEqual(canonicalizeVariant('tef', '97'), ['TEF', '097']);
});

test('canonicalizeVariant handles mixed case set codes', () => {
  assert.deepStrictEqual(canonicalizeVariant('SvI', '42'), ['SVI', '042']);
  assert.deepStrictEqual(canonicalizeVariant('TEF', '1'), ['TEF', '001']);
});

test('canonicalizeVariant returns [null, null] for empty set code', () => {
  assert.deepStrictEqual(canonicalizeVariant('', '118'), [null, null]);
  assert.deepStrictEqual(canonicalizeVariant(null, '118'), [null, null]);
  assert.deepStrictEqual(canonicalizeVariant(undefined, '118'), [null, null]);
});

test('canonicalizeVariant returns [setCode, null] for empty number', () => {
  assert.deepStrictEqual(canonicalizeVariant('SVI', ''), ['SVI', null]);
  assert.deepStrictEqual(canonicalizeVariant('SVI', null), ['SVI', null]);
  assert.deepStrictEqual(canonicalizeVariant('SVI', undefined), ['SVI', null]);
});

test('canonicalizeVariant trims whitespace from set code', () => {
  assert.deepStrictEqual(canonicalizeVariant('  SVI  ', '118'), ['SVI', '118']);
});

// ============================================================================
// buildCardIdentifier tests
// ============================================================================

test('buildCardIdentifier builds SET~NUMBER format', () => {
  assert.strictEqual(buildCardIdentifier('SVI', '118'), 'SVI~118');
  assert.strictEqual(buildCardIdentifier('TEF', '97'), 'TEF~097');
  assert.strictEqual(buildCardIdentifier('paldea', '5'), 'PALDEA~005');
});

test('buildCardIdentifier handles letter suffixes', () => {
  assert.strictEqual(buildCardIdentifier('SVI', '18a'), 'SVI~018A');
  assert.strictEqual(buildCardIdentifier('TEF', '5b'), 'TEF~005B');
});

test('buildCardIdentifier returns null for empty set code', () => {
  assert.strictEqual(buildCardIdentifier('', '118'), null);
  assert.strictEqual(buildCardIdentifier(null, '118'), null);
  assert.strictEqual(buildCardIdentifier(undefined, '118'), null);
});

test('buildCardIdentifier returns null for empty number', () => {
  assert.strictEqual(buildCardIdentifier('SVI', ''), null);
  assert.strictEqual(buildCardIdentifier('SVI', null), null);
  assert.strictEqual(buildCardIdentifier('SVI', undefined), null);
});

test('buildCardIdentifier handles numeric input for number', () => {
  assert.strictEqual(buildCardIdentifier('SVI', 118), 'SVI~118');
  assert.strictEqual(buildCardIdentifier('TEF', 5), 'TEF~005');
});

// ============================================================================
// sanitizeForPath tests
// ============================================================================

test('sanitizeForPath removes invalid path characters', () => {
  assert.strictEqual(sanitizeForPath('hello<world>'), 'helloworld');
  assert.strictEqual(sanitizeForPath('file:name'), 'filename');
  assert.strictEqual(sanitizeForPath('path/to\\file'), 'pathtofile');
  assert.strictEqual(sanitizeForPath('test|value'), 'testvalue');
  assert.strictEqual(sanitizeForPath('question?mark'), 'questionmark');
  assert.strictEqual(sanitizeForPath('star*wild'), 'starwild');
  assert.strictEqual(sanitizeForPath('quote"test'), 'quotetest');
});

test('sanitizeForPath removes path traversal sequences', () => {
  assert.strictEqual(sanitizeForPath('../../../etc/passwd'), 'etcpasswd');
  assert.strictEqual(sanitizeForPath('..'), '');
  assert.strictEqual(sanitizeForPath('dir/../file'), 'dirfile');
});

test('sanitizeForPath removes null bytes', () => {
  assert.strictEqual(sanitizeForPath('hello\0world'), 'helloworld');
  assert.strictEqual(sanitizeForPath('\0\0test\0'), 'test');
});

test('sanitizeForPath trims whitespace', () => {
  assert.strictEqual(sanitizeForPath('  hello  '), 'hello');
  assert.strictEqual(sanitizeForPath('\ttest\n'), 'test');
});

test('sanitizeForPath handles non-string input', () => {
  assert.strictEqual(sanitizeForPath(123), '123');
  assert.strictEqual(sanitizeForPath(null), '');
  assert.strictEqual(sanitizeForPath(undefined), '');
});

test('sanitizeForPath preserves valid characters', () => {
  assert.strictEqual(sanitizeForPath('hello-world_123'), 'hello-world_123');
  assert.strictEqual(sanitizeForPath('Pokemon Card'), 'Pokemon Card');
});

// ============================================================================
// sanitizeForFilename tests
// ============================================================================

test('sanitizeForFilename replaces spaces with underscores', () => {
  assert.strictEqual(sanitizeForFilename('hello world'), 'hello_world');
  assert.strictEqual(sanitizeForFilename('Pokemon TCG Card'), 'Pokemon_TCG_Card');
});

test('sanitizeForFilename also removes invalid characters', () => {
  assert.strictEqual(sanitizeForFilename('file<name>test'), 'filenametest');
  assert.strictEqual(sanitizeForFilename('path:to:file'), 'pathtofile');
});

test('sanitizeForFilename handles combined cases', () => {
  assert.strictEqual(sanitizeForFilename('hello world<test>'), 'hello_worldtest');
  assert.strictEqual(sanitizeForFilename('../my file name'), 'my_file_name');
});

test('sanitizeForFilename handles null/undefined', () => {
  assert.strictEqual(sanitizeForFilename(null), '');
  assert.strictEqual(sanitizeForFilename(undefined), '');
});

// ============================================================================
// normalizeArchetypeName tests
// ============================================================================

test('normalizeArchetypeName replaces underscores with spaces', () => {
  assert.strictEqual(normalizeArchetypeName('Charizard_Pidgeot'), 'charizard pidgeot');
  assert.strictEqual(normalizeArchetypeName('Iron_Thorns_ex'), 'iron thorns ex');
});

test('normalizeArchetypeName lowercases the result', () => {
  assert.strictEqual(normalizeArchetypeName('Charizard'), 'charizard');
  assert.strictEqual(normalizeArchetypeName('GHOLDENGO'), 'gholdengo');
  assert.strictEqual(normalizeArchetypeName('MiXeD CaSe'), 'mixed case');
});

test('normalizeArchetypeName trims whitespace', () => {
  assert.strictEqual(normalizeArchetypeName('  Gholdengo  '), 'gholdengo');
  assert.strictEqual(normalizeArchetypeName('\tCharizard\n'), 'charizard');
});

test('normalizeArchetypeName collapses multiple spaces', () => {
  assert.strictEqual(normalizeArchetypeName('Charizard   Pidgeot'), 'charizard pidgeot');
  assert.strictEqual(normalizeArchetypeName('Iron  Thorns   ex'), 'iron thorns ex');
});

test('normalizeArchetypeName returns "unknown" for empty input', () => {
  assert.strictEqual(normalizeArchetypeName(''), 'unknown');
  assert.strictEqual(normalizeArchetypeName('   '), 'unknown');
  assert.strictEqual(normalizeArchetypeName(null), 'unknown');
  assert.strictEqual(normalizeArchetypeName(undefined), 'unknown');
});

test('normalizeArchetypeName handles underscores and spaces together', () => {
  assert.strictEqual(normalizeArchetypeName('Charizard_Pidgeot ex'), 'charizard pidgeot ex');
  assert.strictEqual(normalizeArchetypeName('Iron Thorns_ex'), 'iron thorns ex');
});
