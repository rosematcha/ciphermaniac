/**
 * tests/utils/html.test.ts
 * Tests for src/utils/html.ts HTML escaping utilities
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { escapeHtml } from '../../src/utils/html.js';

// ============================================================================
// escapeHtml - Basic escaping tests
// ============================================================================

test('escapeHtml escapes ampersand', () => {
  assert.strictEqual(escapeHtml('a & b'), 'a &amp; b');
  assert.strictEqual(escapeHtml('&&&'), '&amp;&amp;&amp;');
});

test('escapeHtml escapes less than sign', () => {
  assert.strictEqual(escapeHtml('<tag>'), '&lt;tag&gt;');
  assert.strictEqual(escapeHtml('1 < 2'), '1 &lt; 2');
});

test('escapeHtml escapes greater than sign', () => {
  assert.strictEqual(escapeHtml('a > b'), 'a &gt; b');
  assert.strictEqual(escapeHtml('<script>'), '&lt;script&gt;');
});

test('escapeHtml escapes double quotes', () => {
  assert.strictEqual(escapeHtml('"quotes"'), '&quot;quotes&quot;');
  assert.strictEqual(escapeHtml('say "hello"'), 'say &quot;hello&quot;');
});

test('escapeHtml escapes single quotes', () => {
  assert.strictEqual(escapeHtml("it's"), 'it&#x27;s');
  assert.strictEqual(escapeHtml("don't"), 'don&#x27;t');
});

test('escapeHtml escapes all HTML special characters together', () => {
  const input = '<script>alert("XSS");</script> & it\'s bad';
  const expected = '&lt;script&gt;alert(&quot;XSS&quot;);&lt;/script&gt; &amp; it&#x27;s bad';
  assert.strictEqual(escapeHtml(input), expected);
});

// ============================================================================
// escapeHtml - Null and undefined handling
// ============================================================================

test('escapeHtml handles null', () => {
  assert.strictEqual(escapeHtml(null), '');
});

test('escapeHtml handles undefined', () => {
  assert.strictEqual(escapeHtml(undefined), '');
});

test('escapeHtml handles empty string', () => {
  assert.strictEqual(escapeHtml(''), '');
});

// ============================================================================
// escapeHtml - Pass-through tests
// ============================================================================

test('escapeHtml passes through safe strings unchanged', () => {
  assert.strictEqual(escapeHtml('Hello World'), 'Hello World');
  assert.strictEqual(escapeHtml('Simple text'), 'Simple text');
  assert.strictEqual(escapeHtml('1234567890'), '1234567890');
});

test('escapeHtml passes through numbers when coerced to string', () => {
  // The function uses String() coercion
  assert.strictEqual(escapeHtml(123 as unknown as string), '123');
  assert.strictEqual(escapeHtml(0 as unknown as string), '');
  assert.strictEqual(escapeHtml(-45.6 as unknown as string), '-45.6');
});

// ============================================================================
// escapeHtml - Unicode handling
// ============================================================================

test('escapeHtml preserves unicode characters', () => {
  assert.strictEqual(escapeHtml('日本語'), '日本語');
  assert.strictEqual(escapeHtml('Ñoño'), 'Ñoño');
  assert.strictEqual(escapeHtml('emoji 🎉'), 'emoji 🎉');
});

test('escapeHtml escapes HTML in unicode strings', () => {
  assert.strictEqual(escapeHtml('<日本語>'), '&lt;日本語&gt;');
  assert.strictEqual(escapeHtml("emoji's <🎉>"), 'emoji&#x27;s &lt;🎉&gt;');
});

// ============================================================================
// escapeHtml - XSS prevention tests
// ============================================================================

test('escapeHtml neutralizes script tag injection', () => {
  const xss = '<script>alert("XSS")</script>';
  const result = escapeHtml(xss);
  assert.ok(!result.includes('<script>'), 'Should not contain literal script tag');
  assert.ok(!result.includes('</script>'), 'Should not contain literal script close tag');
  assert.strictEqual(result, '&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;');
});

test('escapeHtml neutralizes event handler injection', () => {
  const xss = '<img onerror="alert(1)" src=x>';
  const result = escapeHtml(xss);
  assert.ok(!result.includes('<img'), 'Should not contain literal img tag');
  assert.strictEqual(result, '&lt;img onerror=&quot;alert(1)&quot; src=x&gt;');
});

test('escapeHtml neutralizes javascript protocol', () => {
  const xss = '<a href="javascript:alert(1)">click</a>';
  const result = escapeHtml(xss);
  assert.ok(!result.includes('<a'), 'Should not contain literal anchor tag');
});

test('escapeHtml handles nested quotes', () => {
  const input = `He said "it's 'fine'"`;
  const expected = `He said &quot;it&#x27;s &#x27;fine&#x27;&quot;`;
  assert.strictEqual(escapeHtml(input), expected);
});

// ============================================================================
// escapeHtml - Edge cases
// ============================================================================

test('escapeHtml handles very long strings', () => {
  const longString = '<'.repeat(10000);
  const result = escapeHtml(longString);
  assert.strictEqual(result.length, 40000); // Each < becomes &lt; (4 chars)
  assert.ok(!result.includes('<'));
});

test('escapeHtml handles strings with only special characters', () => {
  assert.strictEqual(escapeHtml('<>&"\''), '&lt;&gt;&amp;&quot;&#x27;');
});

test('escapeHtml handles whitespace-only strings', () => {
  assert.strictEqual(escapeHtml('   '), '   ');
  assert.strictEqual(escapeHtml('\t\n\r'), '\t\n\r');
});

test('escapeHtml handles boolean coercion', () => {
  // false is falsy, returns ''
  assert.strictEqual(escapeHtml(false as unknown as string), '');
  // true becomes 'true'
  assert.strictEqual(escapeHtml(true as unknown as string), 'true');
});
