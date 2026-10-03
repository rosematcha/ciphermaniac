import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const headers = readFileSync(new URL('../../static/_headers', import.meta.url), 'utf8');

function parseRules(source) {
  const rules = [];
  for (const line of source.split('\n')) {
    if (line.startsWith('/')) {
      rules.push({ path: line.trim(), directives: [] });
    } else if (line.trim() === '! Cache-Control' || line.trim().startsWith('Cache-Control:')) {
      rules.at(-1).directives.push(line.trim());
    }
  }
  return rules;
}

function cacheControl(path, source = headers) {
  const values = [];
  for (const rule of parseRules(source)) {
    const pattern = new RegExp(
      `^${rule.path
        .split('*')
        .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*')}$`
    );
    if (!pattern.test(path)) {
      continue;
    }
    for (const directive of rule.directives) {
      if (directive === '! Cache-Control') {
        values.length = 0;
      } else {
        values.push(directive.slice('Cache-Control:'.length).trim());
      }
    }
  }
  return values.join(', ');
}

test('service worker script prevents HTTP storage and requires revalidation', () => {
  assert.equal(cacheControl('/sw.js'), 'no-store, no-cache, must-revalidate');
});

test('Pages app routes and R2-only paths receive no custom cache policy', () => {
  for (const path of [
    '/live/testcup-2027',
    '/live/v1/schedule.json',
    '/releases/v1/online/aaaaaaaaaaaa/master.json',
    '/current.json',
    '/channels/shadow.json',
    '/manifest.webmanifest'
  ]) {
    assert.equal(cacheControl(path), '', path);
  }
});

test('bundles, fonts and snapshots retain an unambiguous year-long policy', () => {
  for (const path of ['/assets/app-hash.js', '/fonts/inter.woff2', '/reports/Snapshots/2026-01-01/master.json']) {
    assert.equal(cacheControl(path), 'public, max-age=31536000, immutable', path);
  }
  assert.equal(cacheControl('/reports/master.json'), 'public, max-age=21600');
  assert.equal(cacheControl('/reports/Snapshots/index.json'), 'public, max-age=21600');
});

test('matching Pages rules merge values unless explicitly detached', () => {
  const source =
    '/reports/*\n  Cache-Control: public, max-age=21600\n/reports/Snapshots/*\n  Cache-Control: public, max-age=31536000, immutable';
  assert.equal(
    cacheControl('/reports/Snapshots/data.json', source),
    'public, max-age=21600, public, max-age=31536000, immutable'
  );
  assert.equal(
    cacheControl(
      '/reports/Snapshots/data.json',
      source.replace('/reports/Snapshots/*\n', '/reports/Snapshots/*\n  ! Cache-Control\n')
    ),
    'public, max-age=31536000, immutable'
  );
});
