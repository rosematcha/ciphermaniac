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
  const attempts: string[] = buildAttempts('SVI', '181', 'lg', 'r2');
  assert.ok(attempts[0].includes(R2), attempts[0]);
  assert.ok(attempts[0].endsWith('_LG.webp'));
});

test('skipR2 removes the R2 attempt entirely', () => {
  const attempts: string[] = buildAttempts('SVI', '181', 'lg', 'proxy');
  assert.equal(
    attempts.some(u => u.includes(R2)),
    false,
    'no attempt may hit R2 when the caller opted out'
  );
  assert.ok(attempts[0].startsWith(PROXY));
});

test('skipR2 preserves the size fallback chain and its order', () => {
  const withR2 = buildAttempts('SVI', '181', 'lg', 'r2').filter(u => u.startsWith(PROXY));
  const without = buildAttempts('SVI', '181', 'lg', 'proxy');
  assert.deepEqual(without, withR2, 'dropping the R2 tier must not reorder or lose proxy tiers');
  assert.deepEqual(
    without.map(u => u.split('/')[2]),
    ['lg', 'sm', 'xs']
  );
});

test('skipR2 swaps the srcset source rather than disabling it', () => {
  const withR2 = buildSrcset('SVI', '181', 'lg', 'r2');
  const without = buildSrcset('SVI', '181', 'lg', 'proxy');
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
  assert.ok(buildAttempts('SVI', '1', 'xs', 'r2')[0].includes('_001_'));
  assert.ok(buildAttempts('SVI', '1', 'xs', 'proxy')[0].endsWith('/SVI/001'));
});

test('a vintage set goes to pokemontcg.io regardless of skipR2', () => {
  // Limitless has no scans for those sets, so R2 and its proxy tiers would only 404.
  for (const source of ['r2', 'proxy'] as const) {
    const attempts: string[] = buildAttempts('BS', '4', 'lg', source);
    assert.equal(
      attempts.some(u => u.includes(R2)),
      false,
      `vintage must not hit R2 (source=${source})`
    );
    assert.equal(
      attempts.some(u => u.startsWith(`${PROXY}/lg/`) || u.startsWith(`${PROXY}/sm/`)),
      false,
      `vintage must not ask Limitless for a scan it does not have (source=${source})`
    );
    // Same-origin first: a hotlinked pokemontcg.io scan displays, but sends no
    // CORS header, so it cannot be inlined into an export.
    assert.ok(attempts[0].startsWith(`${PROXY}/ptcgio/base1/4_hires`), attempts[0]);
    assert.ok(attempts.at(-1)?.startsWith('https://images.pokemontcg.io/'), String(attempts.at(-1)));
  }
});

test('the UVU set resolves to a bundled art rather than any CDN', () => {
  assert.deepEqual(buildAttempts('UVU', '002', 'lg', 'r2'), ['/joke-arts/002.webp']);
  assert.deepEqual(buildAttempts('uvu', '002', 'xs', 'proxy'), ['/joke-arts/002.webp']);
  assert.equal(buildSrcset('UVU', '002', 'lg', 'r2'), '/joke-arts/002.webp 460w');
});

test('a hotlink tries the Limitless CDN first and keeps the proxy chain behind it', () => {
  const attempts = buildAttempts('TWM', '188', 'sm', 'hotlink');
  assert.equal(attempts[0], 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/TWM/TWM_188_R_EN_SM.png');
  assert.equal(
    attempts.some(u => u.includes(R2)),
    false,
    'a hotlink never touches our storage'
  );
  // If the CDN challenges the browser, the proxy still serves the art.
  assert.deepEqual(attempts.slice(1), buildAttempts('TWM', '188', 'sm', 'proxy'));
});

test('a hotlink srcset points every tier at the CDN', () => {
  const srcset = buildSrcset('TWM', '1', 'sm', 'hotlink');
  assert.ok(srcset.includes('/tpci/TWM/TWM_001_R_EN_XS.png 136w'), srcset);
  assert.equal(srcset.includes(PROXY), false);
});

test('a UVU number with no bundled art resolves normally, path traversal included', () => {
  for (const number of ['../secrets', '087']) {
    const attempts = buildAttempts('UVU', number, 'xs', 'proxy');
    assert.ok(!attempts.some(u => u.startsWith('/joke-arts/')));
    assert.ok(attempts.length > 0);
  }
});

test('an unnumbered basic Energy (000P) resolves to its bare type letter', () => {
  const attempts = buildAttempts('TEU', '000P', 'lg', 'hotlink');
  assert.ok(attempts[0].endsWith('/TEU/TEU_P_R_EN_LG.png'), attempts[0]);
  assert.equal(attempts[1], `${PROXY}/lg/TEU/P`);
});
