import assert from 'node:assert/strict';
import test from 'node:test';

// Provide minimal fetch implementation before importing browser modules
globalThis.fetch = async () => ({
  ok: true,
  json: async () => ({ synonyms: {}, canonicals: {} })
});

const routingModule = await import('../assets/js/card/routing.js');
const routerModule = await import('../assets/js/router.js');
const { buildCardPath, parseCardRoute } = routingModule;
const { planNormalizeIndexRoute } = routerModule;

test('buildCardPath encodes colon slugs with tilde separators', () => {
  const path = buildCardPath('Miraidon EX::SVI::12');
  assert.equal(path, '/card/SVI~012');
});

test('buildCardPath leaves friendly slugs unchanged', () => {
  const path = buildCardPath('Ultra Ball');
  assert.equal(path, '/card/ultra-ball');
});

test('parseCardRoute decodes tilde separators back to colons', () => {
  const result = parseCardRoute({
    pathname: '/card/SVI~012',
    search: '',
    hash: ''
  });

  assert.equal(result.source, 'slug');
  assert.equal(result.slug, 'SVI:012');
});

test('parseCardRoute supports legacy colon slugs directly', () => {
  const result = parseCardRoute({
    pathname: '/card/SVI:045',
    search: '',
    hash: ''
  });

  assert.equal(result.source, 'slug');
  assert.equal(result.slug, 'SVI:045');
});

test('parseCardRoute detects landing page without slug or hash', () => {
  const result = parseCardRoute({
    pathname: '/card',
    search: '',
    hash: ''
  });

  assert.equal(result.source, 'landing');
  assert.equal(result.slug, null);
  assert.equal(result.identifier, null);
});

test('parseCardRoute treats trailing slash landing path as landing', () => {
  const result = parseCardRoute({
    pathname: '/card/',
    search: '',
    hash: ''
  });

  assert.equal(result.source, 'landing');
  assert.equal(result.slug, null);
  assert.equal(result.identifier, null);
});

test('planNormalizeIndexRoute redirects hash routes to tilde slug paths', () => {
  const plan = planNormalizeIndexRoute({
    hash: '#card/SVI:123',
    search: '?ref=nav',
    pathname: '/index.html'
  });

  assert.equal(plan.redirect, true);
  assert.equal(plan.url, '/card/SVI~123?ref=nav');
});

test('planNormalizeIndexRoute ignores non-card hashes', () => {
  const plan = planNormalizeIndexRoute({
    hash: '#grid',
    search: '',
    pathname: '/index.html'
  });

  assert.equal(plan.redirect, false);
});
