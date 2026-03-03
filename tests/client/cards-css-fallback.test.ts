import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const cardsHtmlPath = path.join(process.cwd(), 'public', 'cards.html');

test('/cards defaults split CSS off while keeping explicit opt-in hooks', () => {
  const html = fs.readFileSync(cardsHtmlPath, 'utf8');

  assert.ok(
    html.includes('let enabled = false;'),
    'Expected /cards inline style bootstrap to default split CSS to disabled'
  );
  assert.ok(
    html.includes("['/assets/style-core.css?v=20260302a', '/assets/style-cards.css?v=20260302a']"),
    'Expected split CSS assets to remain referenced for explicit opt-in paths'
  );
  assert.ok(
    html.includes("const flagName = 'usePageCssSplit';"),
    'Expected /cards to keep feature-flag override plumbing'
  );
});

test('/cards noscript fallback uses legacy full stylesheet', () => {
  const html = fs.readFileSync(cardsHtmlPath, 'utf8');
  const noscriptMatch = html.match(/<noscript>([\s\S]*?)<\/noscript>/);

  assert.ok(noscriptMatch, 'Expected /cards to include a noscript stylesheet fallback');
  const noscriptBody = noscriptMatch[1];

  assert.ok(
    noscriptBody.includes('/assets/style.css?v=20260214h'),
    'Expected noscript fallback to load legacy style.css'
  );
  assert.ok(
    !noscriptBody.includes('/assets/style-core.css'),
    'Expected noscript fallback to stop loading style-core.css for /cards'
  );
  assert.ok(
    !noscriptBody.includes('/assets/style-cards.css'),
    'Expected noscript fallback to stop loading style-cards.css for /cards'
  );
});
