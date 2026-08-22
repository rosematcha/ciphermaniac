/**
 * CardImage source selection.
 *
 * The R2 bucket only holds art the conversion pipeline has SEEN in a recent
 * tournament, so any printing outside that set 404s before the proxy retry
 * succeeds. `skipR2` is how a caller says "these images are probably not in
 * there" — and an adversarial review found the card page's hero, which renders
 * a previewed filmstrip printing at the `lg` tier, was still missing it.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAttempts, buildSrcset } from '../../src/components/cardImage/sources.ts';

const R2 = 'r2.ciphermaniac.com/card-images';
const PROXY = '/thumbnails';

test('with R2 available the first attempt is the WebP tier', () => {
  const attempts: string[] = buildAttempts('SVI', '181', 'lg', true);
  assert.ok(attempts[0].includes(R2), attempts[0]);
  assert.ok(attempts[0].endsWith('_LG.webp'));
});

test('skipR2 removes the R2 attempt entirely', () => {
  const attempts: string[] = buildAttempts('SVI', '181', 'lg', false);
  assert.equal(
    attempts.some(u => u.includes(R2)),
    false,
    'no attempt may hit R2 when the caller opted out'
  );
  assert.ok(attempts[0].startsWith(PROXY));
});

test('skipR2 preserves the size fallback chain and its order', () => {
  const withR2 = buildAttempts('SVI', '181', 'lg', true).filter(u => u.startsWith(PROXY));
  const without = buildAttempts('SVI', '181', 'lg', false);
  assert.deepEqual(without, withR2, 'dropping the R2 tier must not reorder or lose proxy tiers');
  assert.deepEqual(
    without.map(u => u.split('/')[2]),
    ['lg', 'sm', 'xs']
  );
});

test('skipR2 swaps the srcset source rather than disabling it', () => {
  const withR2 = buildSrcset('SVI', '181', 'lg', true);
  const without = buildSrcset('SVI', '181', 'lg', false);
  assert.ok(withR2.includes(R2));
  assert.ok(without.length > 0, 'srcset must survive the opt-out');
  assert.equal(without.includes(R2), false);
  // Same tiers, same widths — only the origin differs.
  assert.deepEqual(
    without.split(', ').map(p => p.split(' ')[1]),
    withR2.split(', ').map(p => p.split(' ')[1])
  );
});

test('the number is zero-padded for both sources, since the CDN is strict about it', () => {
  assert.ok(buildAttempts('SVI', '1', 'xs', true)[0].includes('_001_'));
  assert.ok(buildAttempts('SVI', '1', 'xs', false)[0].endsWith('/SVI/001'));
});

test('a vintage set goes straight to pokemontcg.io regardless of skipR2', () => {
  // Limitless has no scans for those sets, so R2 and the proxy would only 404.
  for (const useR2 of [true, false]) {
    const attempts: string[] = buildAttempts('BS', '4', 'lg', useR2);
    assert.equal(
      attempts.some(u => u.includes(R2) || u.startsWith(PROXY)),
      false,
      `vintage must not hit R2 or the proxy (useR2=${useR2})`
    );
  }
});
