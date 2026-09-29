/**
 * tests/shared/cardUtils.test.ts
 * Tests for shared/cardUtils - card utility functions used across frontend and backend
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeArchetypeName,
  sanitizeDisplayName,
  sanitizeForFilename,
  sanitizeForPath
} from '../../shared/cardUtils';
import { buildCardId, canonicalizeVariant, normalizeCardNumber } from '../../shared/data/cardIdentity';

test('normalizeCardNumber pads digits to three, uppercases suffixes, and leaves prefixed numbers alone', () => {
  const cases: Array<[string | number | null | undefined, string]> = [
    ['5', '005'],
    ['18', '018'],
    ['118', '118'],
    ['001', '001'],
    [5, '005'],
    [118, '118'],
    ['18a', '018A'],
    ['118a', '118A'],
    ['5gg', '005GG'],
    ['GG05', 'GG05'],
    ['gg05', 'GG05'],
    ['TG15', 'TG15'],
    ['  5  ', '005'],
    ['\t18\n', '018'],
    ['', ''],
    ['   ', ''],
    [null, ''],
    [undefined, '']
  ];
  for (const [input, expected] of cases) {
    assert.strictEqual(normalizeCardNumber(input), expected, JSON.stringify(input));
  }
});

test('canonicalizeVariant uppercases and trims the set, and nulls what is missing', () => {
  const cases: Array<[string | null | undefined, string | null | undefined, [string | null, string | null]]> = [
    ['svi', '118', ['SVI', '118']],
    ['SvI', '42', ['SVI', '042']],
    ['  SVI  ', '118', ['SVI', '118']],
    ['', '118', [null, null]],
    [null, '118', [null, null]],
    [undefined, '118', [null, null]],
    ['SVI', '', ['SVI', null]],
    ['SVI', null, ['SVI', null]],
    ['SVI', undefined, ['SVI', null]]
  ];
  for (const [set, number, expected] of cases) {
    assert.deepStrictEqual(canonicalizeVariant(set, number), expected, `${set}/${number}`);
  }
});

test('buildCardId builds SET~NUMBER and keeps an empty number for callers to validate', () => {
  const cases: Array<[string, string | number | null | undefined, string]> = [
    ['SVI', '118', 'SVI~118'],
    ['paldea', '5', 'PALDEA~005'],
    ['SVI', '18a', 'SVI~018A'],
    ['TEF', 5, 'TEF~005'],
    ['SVI', '', 'SVI~'],
    ['SVI', null, 'SVI~'],
    ['SVI', undefined, 'SVI~']
  ];
  for (const [set, number, expected] of cases) {
    assert.strictEqual(buildCardId(set, number), expected, `${set}/${number}`);
  }
});

test('sanitizeForPath strips invalid characters, traversal, and null bytes', () => {
  const cases: Array<[unknown, string]> = [
    ['hello<world>', 'helloworld'],
    ['file:name', 'filename'],
    ['path/to\\file', 'pathtofile'],
    ['test|value?*"', 'testvalue'],
    ['../../../etc/passwd', 'etcpasswd'],
    ['..', ''],
    ['dir/../file', 'dirfile'],
    // A long input is stripped the same way, not truncated or skipped.
    [`${'A'.repeat(5000)}/../etc/passwd`, `${'A'.repeat(5000)}etcpasswd`],
    ['\0\0test\0', 'test'],
    ['\ttest\n', 'test'],
    ['hello-world_123', 'hello-world_123'],
    ['Pokemon Card', 'Pokemon Card'],
    [123, '123'],
    [null, ''],
    [undefined, '']
  ];
  for (const [input, expected] of cases) {
    assert.strictEqual(sanitizeForPath(input), expected, JSON.stringify(input));
  }
});

test('sanitizeForFilename replaces spaces with underscores and sanitizes like a path', () => {
  const cases: Array<[unknown, string]> = [
    ['Pokemon TCG Card', 'Pokemon_TCG_Card'],
    ['path:to:file', 'pathtofile'],
    ['hello world<test>', 'hello_worldtest'],
    ['../my file name', 'my_file_name'],
    [null, ''],
    [undefined, '']
  ];
  for (const [input, expected] of cases) {
    assert.strictEqual(sanitizeForFilename(input), expected, JSON.stringify(input));
  }
});

test('normalizeArchetypeName lowercases, turns underscores into single spaces, and defaults to unknown', () => {
  const cases: Array<[string | null | undefined, string]> = [
    ['Charizard_Pidgeot', 'charizard pidgeot'],
    ['GHOLDENGO', 'gholdengo'],
    ['Ünicode—Name', 'ünicode—name'],
    ['\tCharizard\n', 'charizard'],
    ['Iron  Thorns   ex', 'iron thorns ex'],
    ['Iron Thorns_ex', 'iron thorns ex'],
    ['', 'unknown'],
    ['   ', 'unknown'],
    [null, 'unknown'],
    [undefined, 'unknown']
  ];
  for (const [input, expected] of cases) {
    assert.strictEqual(normalizeArchetypeName(input), expected, JSON.stringify(input));
  }
});

test('sanitizeDisplayName preserves punctuation but blocks traversal/injection', () => {
  // Colon-bearing card names (e.g. Technical Machine ACE SPECs) keep their colon.
  assert.strictEqual(sanitizeDisplayName('Technical Machine: Evolution'), 'Technical Machine: Evolution');
  assert.strictEqual(sanitizeDisplayName("Boss's Orders"), "Boss's Orders");
  // Path traversal + separators are still stripped.
  assert.strictEqual(sanitizeDisplayName('EvilCard/..\\secret'), 'EvilCardsecret');
  // Control characters (built without a literal) are removed.
  assert.strictEqual(sanitizeDisplayName(`a${String.fromCharCode(1)}bc`), 'abc');
});
