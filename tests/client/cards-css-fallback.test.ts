import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const cardsHtmlPath = path.join(process.cwd(), 'public', 'cards.html');

test('/cards uses hardcoded split CSS (feature flag graduated)', () => {
  const html = fs.readFileSync(cardsHtmlPath, 'utf8');

  assert.ok(html.includes('/assets/style-core.css?v='), 'Expected /cards to include a style-core.css link');
  assert.ok(html.includes('/assets/style-cards.css?v='), 'Expected /cards to include a style-cards.css link');
  assert.ok(!html.includes('usePageCssSplit'), 'Expected feature flag loader to be removed after graduation');
});
