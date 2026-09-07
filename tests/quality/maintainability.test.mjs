import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Linter } from 'eslint';
import { maintainabilityRule } from '../../scripts/quality/maintainability.mjs';

const filename = '/quality/src/example.js';
const complex = `function calculate(x) { ${Array.from({ length: 13 }, (_, i) => `if (x === ${i}) return ${i};`).join(' ')} return 0; }`;

function lint(code, baseline = {}) {
  return new Linter({ cwd: '/quality' }).verify(
    code,
    [
      {
        plugins: { quality: { rules: { maintainability: maintainabilityRule('/quality', baseline) } } },
        rules: { 'quality/maintainability': 'error' }
      }
    ],
    { filename }
  );
}

function exception(code) {
  return lint(code).map(message => message.message.match(/\[(.*)\]$/)[1]);
}

test('rejects a new complex function', () => {
  assert.match(lint(complex)[0].message, /complexity of 14/);
});

test('accepts only the exact legacy function, independent of whitespace', () => {
  const baseline = { 'src/example.js': exception(complex) };
  assert.deepEqual(lint(complex.replaceAll(';', ';\n'), baseline), []);
  assert.ok(lint(complex.replace('return 0;', 'return 2;'), baseline).length > 0);
});

test('an exception cannot shelter a new function in the same file', () => {
  const baseline = { 'src/example.js': exception(complex) };
  const messages = lint(`${complex}\n${complex.replace('calculate', 'another')}`, baseline);
  assert.equal(messages.length, 1);
  assert.match(messages[0].message, /complexity/);
});

test('requires deleting an exception after the function is simplified', () => {
  const baseline = { 'src/example.js': exception(complex) };
  assert.match(lint('function calculate(x) { return x; }', baseline)[0].message, /stale/);
});

test('preserves the number of identical nesting violations', () => {
  const code = 'function f(x) { if(x) { if(x) { if(x) { if(x) {} if(x) {} } } } }';
  const baseline = { 'src/example.js': exception(code) };
  assert.equal(baseline['src/example.js'].length, 2);
  assert.deepEqual(lint(code, baseline), []);
  assert.ok(lint(code + code.replace('f(', 'g('), baseline).length > 0);
});
