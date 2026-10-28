/**
 * Fan-translated images of Japanese-only cards, mirrored from
 * pokemonproxies.com into R2. Never hotlinked: the site is a volunteer
 * project, and its image URLs carry a content hash that changes whenever an
 * image is re-exported.
 *
 * The site has no index file. Its JS bundle carries a Vite glob map from each
 * source path (`../public/images/cards/sets/Delta_Reign/6a-062-Talonflame_ex.png`)
 * to the hashed asset (`/assets/6a-062-Talonflame_ex-BvFdJqJQ.png`). The
 * prefix (`6a`) is the site's own set scheme; .github/scripts/data/jp-proxy-sets.json
 * maps it to the Japanese set code (`M6`), and the number is the Japanese
 * collector number.
 */
import sharp from 'sharp';
import PROXY_SETS from '../../data/jp-proxy-sets.json';
import { jpCardImageKey, type JpImageTier } from '../../../../shared/data/japanOnlyCards';
import { PROXY_MANIFEST_KEY } from './keys';
import type { CityLeagueStore } from './types';

export const PROXY_ORIGIN = 'https://www.pokemonproxies.com';

/** Widths of the tiers CardImage requests, as for the English art. */
const TIER_WIDTHS: Record<JpImageTier, number> = { XS: 136, SM: 274, LG: 460 };
const WEBP_QUALITY = 80;

export interface ProxyAsset {
  /** Site folder, e.g. `Delta_Reign`. */
  folder: string;
  /** Site set prefix, e.g. `6a`. */
  prefix: string;
  /** Japanese collector number, three digits. */
  number: string;
  /** The site's English name for the card. */
  name: string;
  /** Hashed asset path on the site. */
  asset: string;
}

const BUNDLE_SRC = /<script[^>]+src="(\/assets\/index-[^"]+\.js)"/;
const GLOB_KEY = /\.\.\/public\/images\/cards\/sets\/([^/"`]+)\/(\d+[a-z])-(\d{3})-([^"`/]+?)\.png/g;
const HASHED_ASSET = /\/assets\/(\d+[a-z]-\d{3})-[^"`/]+\.png/g;

/** The bundle path the site's index page loads. */
export function findBundlePath(indexHtml: string): string | null {
  return BUNDLE_SRC.exec(indexHtml)?.[1] ?? null;
}

/**
 * Every card image the bundle knows, joined from its glob keys to its hashed
 * assets by prefix and number. Not by the whole stem: Vite rewrites some
 * characters in asset names (`Tate_&_Liza's` becomes `Tate___Liza's`).
 * @param js - The site's JS bundle
 * @returns One entry per image, in bundle order
 */
export function parseProxyBundle(js: string): ProxyAsset[] {
  const assets = new Map<string, string>();
  for (const match of js.matchAll(HASHED_ASSET)) {
    assets.set(match[1], match[0]);
  }
  const found = new Map<string, ProxyAsset>();
  for (const [, folder, prefix, number, rawName] of js.matchAll(GLOB_KEY)) {
    const id = `${prefix}-${number}`;
    const asset = assets.get(id);
    if (asset) {
      found.set(id, { folder, prefix, number, name: rawName.replaceAll('_', ' '), asset });
    }
  }
  return [...found.values()];
}

const PREFIX_SETS: Record<string, string | null> = PROXY_SETS.prefixes;

/** The Japanese set a site prefix stands for, or null while it is unmapped. */
export function jpSetOfPrefix(prefix: string, prefixes: Record<string, string | null> = PREFIX_SETS): string | null {
  return prefixes[prefix] ?? null;
}

interface ProxyManifestEntry {
  asset: string;
  name: string;
  mirroredAt: string;
}

/** What has been mirrored, keyed `{SET}/{NNN}`, so a re-exported image (new hash) is mirrored again. */
interface ProxyManifest {
  schemaVersion: 1;
  updatedAt: string;
  images: Record<string, ProxyManifestEntry>;
}

export interface ProxyImageStore extends Pick<CityLeagueStore, 'read' | 'write'> {
  putObject(key: string, body: Uint8Array, contentType: string): Promise<void>;
}

export type EncodeTiers = (png: Uint8Array) => Promise<Record<JpImageTier, Uint8Array>>;

/** The PNG as one WebP per tier, never enlarged. */
export const encodeTiers: EncodeTiers = async png => {
  const entries = await Promise.all(
    (Object.keys(TIER_WIDTHS) as JpImageTier[]).map(async tier => {
      const webp = await sharp(png)
        .resize({ width: TIER_WIDTHS[tier], withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer();
      return [tier, new Uint8Array(webp)] as const;
    })
  );
  return Object.fromEntries(entries) as Record<JpImageTier, Uint8Array>;
};

export interface MirrorProxyImagesOptions {
  store: ProxyImageStore;
  fetchText(url: string): Promise<string>;
  fetchBytes(url: string): Promise<Uint8Array>;
  now: Date;
  /** Test seam for the WebP encode. */
  encode?: EncodeTiers;
  prefixes?: Record<string, string | null>;
}

async function mirrorOne(entry: ProxyAsset & { set: string }, options: MirrorProxyImagesOptions): Promise<void> {
  const png = await options.fetchBytes(`${PROXY_ORIGIN}${entry.asset}`);
  const tiers = await (options.encode ?? encodeTiers)(png);
  for (const tier of Object.keys(tiers) as JpImageTier[]) {
    await options.store.putObject(jpCardImageKey(entry.set, entry.number, tier), tiers[tier], 'image/webp');
  }
}

async function loadManifest(store: ProxyImageStore): Promise<ProxyManifest> {
  const stored = await store.read<ProxyManifest>(PROXY_MANIFEST_KEY);
  return stored?.schemaVersion === 1 ? stored : { schemaVersion: 1, updatedAt: '', images: {} };
}

/**
 * Mirror every mapped image the site offers that we don't hold yet, or whose
 * asset hash changed since we mirrored it.
 * @param options - Store, fetchers and clock
 * @returns Counts of images mirrored, already current, and skipped for an unmapped prefix
 */
export async function mirrorProxyImages(
  options: MirrorProxyImagesOptions
): Promise<{ mirrored: number; current: number; unmapped: number }> {
  const bundlePath = findBundlePath(await options.fetchText(`${PROXY_ORIGIN}/`));
  if (!bundlePath) {
    throw new Error('pokemonproxies.com: no index bundle on the home page');
  }
  const assets = parseProxyBundle(await options.fetchText(`${PROXY_ORIGIN}${bundlePath}`));
  const manifest = await loadManifest(options.store);
  const stats = { mirrored: 0, current: 0, unmapped: 0 };
  const today = options.now.toISOString().slice(0, 10);
  for (const asset of assets) {
    const set = jpSetOfPrefix(asset.prefix, options.prefixes);
    const key = set ? `${set}/${asset.number}` : '';
    if (!set) {
      stats.unmapped += 1;
    } else if (manifest.images[key]?.asset === asset.asset) {
      stats.current += 1;
    } else {
      await mirrorOne({ ...asset, set }, options);
      manifest.images[key] = { asset: asset.asset, name: asset.name, mirroredAt: today };
      stats.mirrored += 1;
    }
  }
  if (stats.mirrored) {
    manifest.updatedAt = today;
    await options.store.write(PROXY_MANIFEST_KEY, manifest);
  }
  return stats;
}
