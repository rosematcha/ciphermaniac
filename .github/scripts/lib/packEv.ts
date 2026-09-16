/**
 * Pack-EV artifact builder.
 *
 * For each set in `config/pack-ev.json`: pull its TCGCSV group (every product
 * and every market price), turn that into the card list and sealed prices the
 * slot model needs, compute the EV, and publish one payload per set plus a
 * small index.
 *
 * The transport and the publisher are injected so the whole build runs in a
 * test against fixture JSON — the shape of a TCGCSV group is exactly the kind
 * of thing that changes under you (a renamed rarity, a delisted booster box),
 * and those are the failures this job has to shout about rather than publish.
 * @module .github/scripts/lib/packEv
 */

import { computePackEv, resolveRef, selectPool } from '../../../shared/packEv/ev.ts';
import type {
  FoilPattern,
  PackCard,
  PackEvConfig,
  PackEvIndex,
  PackEvIndexEntry,
  PackEvSetConfig,
  PackEvSetPayload,
  Printing,
  SealedProduct
} from '../../../shared/packEv/types.ts';

const TCGCSV_CATEGORY_URL = 'https://tcgcsv.com/tcgplayer/3';
export const PACK_EV_PREFIX = 'reports/pack-ev/';
export const PACK_EV_INDEX_KEY = `${PACK_EV_PREFIX}index.json`;
/** Same six-hour window the daily price artifacts use; this rebuilds daily. */
export const PACK_EV_CACHE_CONTROL = 'public, max-age=21600';

/** TCGplayer's price rows name printings; ours are shorter and typed. */
const PRINTING_BY_SUBTYPE: Record<string, Printing> = {
  Normal: 'normal',
  Holofoil: 'holofoil',
  'Reverse Holofoil': 'reverse'
};

/** A trailing parenthetical: how TCGplayer names a variant product. */
const VARIANT_SUFFIX = /\s*\(([^)]+)\)\s*$/;

export interface TcgcsvExtendedField {
  name: string;
  value: string;
}

export interface TcgcsvProduct {
  productId: number;
  name: string;
  url: string;
  extendedData?: TcgcsvExtendedField[];
}

export interface TcgcsvPrice {
  productId: number;
  subTypeName: string;
  marketPrice: number | null;
}

export interface TcgcsvGroup {
  groupId: number;
  name: string;
  publishedOn?: string | null;
}

/** Fetches a URL and returns parsed JSON. Injected so tests never touch the net. */
export type FetchJson = (url: string) => Promise<unknown>;

/** Write-only sink: this job replaces its artifacts outright every run. */
export interface PackEvPublisher {
  write(key: string, value: unknown): Promise<void>;
}

type PriceIndex = Map<number, Partial<Record<Printing, number>>>;

function results<T>(payload: unknown, url: string): T[] {
  const envelope = payload as { success?: boolean; results?: T[] } | null;
  if (!envelope || envelope.success !== true || !Array.isArray(envelope.results)) {
    throw new Error(`TCGCSV returned no usable results for ${url}`);
  }
  return envelope.results;
}

async function fetchResults<T>(url: string, fetchJson: FetchJson): Promise<T[]> {
  return results<T>(await fetchJson(url), url);
}

function extended(product: TcgcsvProduct): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const field of product.extendedData ?? []) {
    fields[field.name] = field.value;
  }
  return fields;
}

function buildPriceIndex(prices: TcgcsvPrice[]): PriceIndex {
  const index: PriceIndex = new Map();
  for (const price of prices) {
    const printing = PRINTING_BY_SUBTYPE[price.subTypeName];
    if (!printing || typeof price.marketPrice !== 'number') {
      continue;
    }
    const entry = index.get(price.productId) ?? {};
    entry[printing] = price.marketPrice;
    index.set(price.productId, entry);
  }
  return index;
}

/**
 * Display name for a card.
 *
 * TCGplayer disambiguates same-name products by appending the collector number
 * ("Pinsir - 003/167") and names the alternate foils in the title ("Exeggcute
 * (Poke Ball Pattern)"). Both are already fields here, so neither belongs in
 * the name a pull is rendered with.
 */
export function cardDisplayName(rawName: string, number: string): string {
  let name = rawName.replace(VARIANT_SUFFIX, '');
  const numbered = ` - ${number}`;
  if (name.endsWith(numbered)) {
    name = name.slice(0, -numbered.length);
  }
  return name.trim();
}

/**
 * The variant a product is, slugged from its parenthetical: "(Poke Ball
 * Pattern)" is `poke-ball-pattern`, "(151 Metal Card)" is `151-metal-card`.
 * Any parenthetical counts. Ascended Heroes alone has seven ball and symbol
 * patterns, and a variant misread as a base print would join every base pool.
 */
export function patternOf(name: string): FoilPattern | undefined {
  const match = VARIANT_SUFFIX.exec(name);
  return match
    ? match[1]
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
    : undefined;
}

/** Every product with a collector number and a rarity — i.e. the cards. */
export function toCards(products: TcgcsvProduct[], prices: PriceIndex): PackCard[] {
  const cards: PackCard[] = [];
  for (const product of products) {
    const fields = extended(product);
    const number = fields.Number;
    const rarity = fields.Rarity;
    if (!number || !rarity) {
      continue;
    }
    const pattern = patternOf(product.name);
    cards.push({
      id: product.productId,
      name: cardDisplayName(product.name, number),
      number,
      rarity,
      ...(pattern ? { pattern } : {}),
      prices: prices.get(product.productId) ?? {}
    });
  }
  return cards;
}

function toSealed(set: PackEvSetConfig, products: TcgcsvProduct[], prices: PriceIndex): SealedProduct[] {
  const byId = new Map(products.map(product => [product.productId, product]));
  return set.sealed.map(entry => {
    const product = byId.get(entry.id);
    if (!product) {
      throw new Error(`${set.code}: sealed product ${entry.id} (${entry.label}) is not in TCGCSV group ${set.groupId}`);
    }
    return {
      ...entry,
      price: prices.get(entry.id)?.normal ?? null,
      url: product.url
    };
  });
}

/**
 * Fail the run when a slot can't be filled.
 *
 * An empty pool means the set's rarity names moved under us (or a group id is
 * wrong), and the EV that would be published is silently missing a whole
 * rarity. Stale numbers beat confidently wrong ones.
 */
function assertPoolsResolve(set: PackEvSetConfig, cards: PackCard[]): void {
  for (const slot of set.slots) {
    for (const outcome of slot.outcomes) {
      if (outcome.pool && selectPool(cards, outcome.pool).length === 0) {
        throw new Error(`${set.code}: no cards match the "${outcome.label}" pool in ${slot.label}`);
      }
    }
  }
}

/**
 * Fail the run when a special pack names something the set doesn't have: a
 * card that isn't in the group, a slot that doesn't exist, an empty pool. A god
 * pack valued as bulk would understate the set without a trace.
 */
function assertSpecialPacksResolve(set: PackEvSetConfig, cards: PackCard[]): void {
  const slotLabels = new Set(set.slots.map(slot => slot.label));
  for (const special of set.specialPacks ?? []) {
    const where = `${set.code}: ${special.label}`;
    const missingSlot = special.keepSlots.find(label => !slotLabels.has(label));
    if (missingSlot) {
      throw new Error(`${where} keeps a slot the set has no "${missingSlot}" for`);
    }
    for (const draw of special.draws) {
      const refs = draw.kind === 'cards' ? draw.cards : draw.kind === 'oneOf' ? draw.groups.flat() : [];
      const missing = refs.find(ref => !resolveRef(cards, ref));
      if (missing) {
        throw new Error(`${where} names ${missing.name} (${missing.rarity}), which is not in the set`);
      }
      if (draw.kind === 'random' && selectPool(cards, draw.pool).length === 0) {
        throw new Error(`${where} draws from an empty ${draw.pool.rarities.join(' / ')} pool`);
      }
    }
  }
}

export interface SetSources {
  products: TcgcsvProduct[];
  prices: TcgcsvPrice[];
  /** TCGplayer's publish date for the group, or null when it has none. */
  releasedOn: string | null;
}

/** One set's published payload, built from its config and its TCGCSV group. */
export function buildSetPayload(
  config: PackEvConfig,
  set: PackEvSetConfig,
  sources: SetSources,
  generatedAt: string
): PackEvSetPayload {
  const prices = buildPriceIndex(sources.prices);
  const cards = toCards(sources.products, prices);
  assertPoolsResolve(set, cards);
  assertSpecialPacksResolve(set, cards);
  const specialPacks = set.specialPacks ?? [];
  const inputs = { cards, slots: set.slots, specialPacks, bulk: config.bulk, threshold: config.threshold };
  return {
    code: set.code,
    name: set.name,
    groupId: set.groupId,
    releasedOn: sources.releasedOn,
    generatedAt,
    source: set.source,
    bulkSource: config.bulkSource,
    threshold: config.threshold,
    bulk: config.bulk,
    slots: set.slots,
    ...(specialPacks.length ? { specialPacks } : {}),
    cards,
    sealed: toSealed(set, sources.products, prices),
    ev: computePackEv(inputs)
  };
}

function indexEntry(payload: PackEvSetPayload): PackEvIndexEntry {
  const primary = payload.sealed.find(product => product.primary) ?? payload.sealed[0];
  return {
    code: payload.code,
    name: payload.name,
    releasedOn: payload.releasedOn,
    evPerPack: payload.ev.perPack,
    costPerPack: primary?.price === null || primary === undefined ? null : primary.price / primary.packs,
    primaryLabel: primary?.label ?? ''
  };
}

/** YYYY-MM-DD out of TCGCSV's `2024-05-24T00:00:00`. */
function publishedDate(group: TcgcsvGroup | undefined): string | null {
  const published = group?.publishedOn;
  return typeof published === 'string' && published.length >= 10 ? published.slice(0, 10) : null;
}

export interface RunPackEvOptions {
  config: PackEvConfig;
  fetchJson: FetchJson;
  publisher: PackEvPublisher;
  now?: () => Date;
  log?: (message: string) => void;
}

/**
 * Build and publish every configured set.
 *
 * Sets are fetched one at a time: five sets is ten requests against a free
 * community mirror, and there is nothing to gain by hammering it.
 *
 * Nothing is written until every set has built. A failure partway through
 * would otherwise leave some sets on today's prices under an index still
 * carrying yesterday's, and the Sets table would disagree with the set it
 * opens. The index goes last so a reader never sees it ahead of its sets.
 */
export async function runPackEv(options: RunPackEvOptions): Promise<PackEvIndex> {
  const { config, fetchJson, publisher } = options;
  const log = options.log ?? (() => {});
  const generatedAt = (options.now?.() ?? new Date()).toISOString();
  const groups = await fetchResults<TcgcsvGroup>(`${TCGCSV_CATEGORY_URL}/groups`, fetchJson);
  const groupsById = new Map(groups.map(group => [group.groupId, group]));

  const payloads: PackEvSetPayload[] = [];
  for (const set of config.sets) {
    const base = `${TCGCSV_CATEGORY_URL}/${set.groupId}`;
    const products = await fetchResults<TcgcsvProduct>(`${base}/products`, fetchJson);
    const prices = await fetchResults<TcgcsvPrice>(`${base}/prices`, fetchJson);
    const releasedOn = publishedDate(groupsById.get(set.groupId));
    payloads.push(buildSetPayload(config, set, { products, prices, releasedOn }, generatedAt));
  }

  for (const payload of payloads) {
    await publisher.write(`${PACK_EV_PREFIX}${payload.code}.json`, payload);
    log(`${payload.code}: ${payload.cards.length} cards, EV $${payload.ev.perPack.toFixed(2)} a pack`);
  }
  const index: PackEvIndex = { generatedAt, sets: payloads.map(indexEntry) };
  await publisher.write(PACK_EV_INDEX_KEY, index);
  return index;
}
