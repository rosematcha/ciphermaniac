import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';

import {
  encodeTiers,
  findBundlePath,
  jpSetOfPrefix,
  mirrorProxyImages,
  parseProxyBundle,
  type ProxyImageStore
} from '../../.github/scripts/lib/cityLeagues/proxies';
import PROXY_SETS from '../../.github/scripts/data/jp-proxy-sets.json';
import { jpCardImageKey } from '../../shared/data/japanOnlyCards';

// pokemonproxies.com saved 2026-10-27: the home page, and the part of its
// bundle that holds the image map.
const fixture = (name: string) => readFileSync(new URL(`../fixtures/city-leagues/${name}`, import.meta.url), 'utf8');

test('the home page names its bundle', () => {
  assert.equal(findBundlePath(fixture('proxies-index.html')), '/assets/index-CXDa139a.js');
  assert.equal(findBundlePath('<html></html>'), null);
});

test('the bundle lists every image with its hashed asset', () => {
  const assets = parseProxyBundle(fixture('proxies-bundle.js.txt'));
  assert.equal(assets.length, 131);
  assert.deepEqual(
    assets.find(asset => asset.prefix === '6a' && asset.number === '062'),
    {
      folder: 'Delta_Reign',
      prefix: '6a',
      number: '062',
      name: 'Talonflame ex',
      asset: '/assets/6a-062-Talonflame_ex-BvFdJqJQ.png'
    }
  );
  // Hashes can contain dashes, and Vite rewrites `&` in asset names.
  assert.equal(assets.find(asset => asset.number === '003')?.asset, '/assets/6a-003-Masquerain-hHhgGS-Z.png');
  assert.equal(
    assets.find(asset => asset.prefix === '6a' && asset.number === '070')?.asset,
    "/assets/6a-070-Tate___Liza's_Training-RGnkiYUX.png"
  );
});

test('every prefix in the bundle is mapped or deliberately left unmapped', () => {
  const prefixes = new Set(parseProxyBundle(fixture('proxies-bundle.js.txt')).map(asset => asset.prefix));
  for (const prefix of prefixes) {
    assert.ok(prefix in PROXY_SETS.prefixes, `prefix ${prefix} has no row in jp-proxy-sets.json`);
  }
  assert.equal(jpSetOfPrefix('6a'), 'M6');
  assert.equal(jpSetOfPrefix('7a'), null);
  assert.equal(jpSetOfPrefix('9z'), null);
});

test('image keys: our own prefix, uppercase set, padded number, one per tier', () => {
  assert.equal(jpCardImageKey('M6', '62', 'SM'), 'jp-card-images/M6/M6_062_SM.webp');
  assert.equal(jpCardImageKey('m6a', '015', 'LG'), 'jp-card-images/M6A/M6A_015_LG.webp');
});

function memoryImageStore(): ProxyImageStore & { objects: Map<string, string>; json: Map<string, unknown> } {
  const objects = new Map<string, string>();
  const json = new Map<string, unknown>();
  return {
    objects,
    json,
    read: async <T>(key: string) => (json.has(key) ? (structuredClone(json.get(key)) as T) : null),
    write: async (key, value) => {
      json.set(key, structuredClone(value));
    },
    putObject: async (key, body, contentType) => {
      objects.set(key, `${contentType}:${body.length}`);
    }
  };
}

function proxySite(bundle: string) {
  const fetched: string[] = [];
  return {
    fetched,
    fetchText: async (url: string) => (url.endsWith('/') ? fixture('proxies-index.html') : bundle),
    fetchBytes: async (url: string) => {
      fetched.push(url);
      return new Uint8Array([1, 2, 3]);
    }
  };
}

const encode = async () => ({ XS: new Uint8Array(1), SM: new Uint8Array(2), LG: new Uint8Array(3) });
const NOW = new Date('2026-10-27T12:00:00Z');

test('mirror: every mapped image once, under its Japanese print', async () => {
  const store = memoryImageStore();
  const site = proxySite(fixture('proxies-bundle.js.txt'));
  const stats = await mirrorProxyImages({ store, ...site, now: NOW, encode });

  assert.deepEqual(stats, { mirrored: 112, current: 0, unmapped: 19 });
  assert.equal(store.objects.size, 112 * 3);
  assert.equal(store.objects.get('jp-card-images/M6/M6_062_SM.webp'), 'image/webp:2');
  assert.ok(store.objects.has('jp-card-images/MEE/MEE_009_LG.webp'), 'Eevee ex from the 6e starter set');
  assert.ok(site.fetched.includes('https://www.pokemonproxies.com/assets/6a-062-Talonflame_ex-BvFdJqJQ.png'));
  assert.ok(!site.fetched.some(url => url.includes('/7a-')), 'unmapped prefixes are not downloaded');
});

test('mirror: a second run downloads nothing, a re-exported image is mirrored again', async () => {
  const store = memoryImageStore();
  await mirrorProxyImages({ store, ...proxySite(fixture('proxies-bundle.js.txt')), now: NOW, encode });

  const again = proxySite(fixture('proxies-bundle.js.txt'));
  assert.deepEqual(await mirrorProxyImages({ store, ...again, now: NOW, encode }), {
    mirrored: 0,
    current: 112,
    unmapped: 19
  });
  assert.equal(again.fetched.length, 0);

  const reexported = proxySite(
    fixture('proxies-bundle.js.txt').replace('Talonflame_ex-BvFdJqJQ', 'Talonflame_ex-NEWHASH0')
  );
  const stats = await mirrorProxyImages({ store, ...reexported, now: NOW, encode });
  assert.equal(stats.mirrored, 1);
  assert.deepEqual(reexported.fetched, ['https://www.pokemonproxies.com/assets/6a-062-Talonflame_ex-NEWHASH0.png']);
});

test('encode: a WebP per tier at the widths CardImage asks for', async () => {
  const png = await sharp({ create: { width: 734, height: 1024, channels: 3, background: '#c33' } })
    .png()
    .toBuffer();
  const tiers = await encodeTiers(new Uint8Array(png));
  for (const [tier, width] of [
    ['XS', 136],
    ['SM', 274],
    ['LG', 460]
  ] as const) {
    const meta = await sharp(tiers[tier]).metadata();
    assert.equal(meta.format, 'webp');
    assert.equal(meta.width, width);
  }
});
