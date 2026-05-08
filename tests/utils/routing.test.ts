import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSearch,
  getParam,
  getParams,
  matchesRoute,
  normalizePath,
  QUERY_KEYS,
  ROUTES
} from '../../src/lib/routing.ts';

test('ROUTES contains expected page paths', () => {
  assert.equal(ROUTES.HOME, '/');
  assert.equal(ROUTES.CARDS, '/cards');
  assert.equal(ROUTES.CARD, '/card');
  assert.equal(ROUTES.TRENDS, '/trends');
});

test('QUERY_KEYS maps semantic names to URL param keys', () => {
  assert.equal(QUERY_KEYS.SEARCH, 'q');
  assert.equal(QUERY_KEYS.TOURNAMENT, 'tour');
  assert.equal(QUERY_KEYS.CARD_TYPE, 'type');
});

test('getParam extracts a single param', () => {
  const loc = { search: '?q=pikachu&sort=name' };
  assert.equal(getParam(loc, 'q'), 'pikachu');
  assert.equal(getParam(loc, 'sort'), 'name');
  assert.equal(getParam(loc, 'missing'), '');
});

test('getParams extracts multiple params at once', () => {
  const loc = { search: '?q=test&sort=pct' };
  const result = getParams(loc, ['q', 'sort', 'missing']);
  assert.equal(result.q, 'test');
  assert.equal(result.sort, 'pct');
  assert.equal(result.missing, '');
});

test('buildSearch creates query string from entries, omitting empties', () => {
  assert.equal(buildSearch({ q: 'hello', sort: '' }), '?q=hello');
  assert.equal(buildSearch({ q: '', sort: '' }), '');
  assert.equal(buildSearch({ q: 'a', sort: 'b' }), '?q=a&sort=b');
  assert.equal(buildSearch({ q: null, sort: undefined }), '');
});

test('normalizePath strips .html and trailing slashes', () => {
  assert.equal(normalizePath('/cards.html'), '/cards');
  assert.equal(normalizePath('/cards/'), '/cards');
  assert.equal(normalizePath('/cards.html/'), '/cards');
  assert.equal(normalizePath('/'), '/');
  assert.equal(normalizePath('/card/SVI~181'), '/card/SVI~181');
});

test('matchesRoute matches with normalization', () => {
  assert.ok(matchesRoute('/cards', '/cards'));
  assert.ok(matchesRoute('/cards.html', '/cards'));
  assert.ok(matchesRoute('/cards/', '/cards'));
  assert.ok(!matchesRoute('/card', '/cards'));
  assert.ok(matchesRoute('/', '/'));
});
