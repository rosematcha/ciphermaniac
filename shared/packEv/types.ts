/**
 * Shapes for the pack-EV artifact: what a pack of a given set is worth if you
 * open it, against what the sealed product costs.
 *
 * `.github/scripts/run-pack-ev.ts` builds one payload per set from TCGCSV
 * (card list, market prices, sealed prices) plus the hand-maintained slot model
 * in `config/sealed-ev.json`, and /tools/pack-ev reads it. The slot model is
 * echoed into the payload rather than bundled into the app so the pull rates,
 * the EV the job published, and the simulator the browser runs can never
 * disagree about the same pack.
 * @module shared/packEv/types
 */

/**
 * TCGplayer prices one product per printing variant. For our purposes:
 * `normal` is the plain base print (commons/uncommons), `holofoil` covers the
 * rare slot and every hit rarity, `reverse` is the reverse-holo print that only
 * commons, uncommons and rares have.
 */
export type Printing = 'normal' | 'holofoil' | 'reverse';

/**
 * Special foil patterns that are their own TCGplayer product rather than a
 * printing of the base card. Prismatic Evolutions is the only set here with
 * any: every common/uncommon/rare has a Poké Ball pattern print, and the
 * Pokémon among them also have a Master Ball pattern print.
 */
export type FoilPattern = 'pokeball' | 'masterball';

export interface PackCard {
  /** TCGplayer product id — stable, and what the product URL is built from. */
  id: number;
  name: string;
  /** Printed collector number as TCGplayer gives it, e.g. `019/167`. */
  number: string;
  /** TCGplayer rarity string, e.g. `Illustration Rare`. Drives pool selection. */
  rarity: string;
  /** Absent on the base print. */
  pattern?: FoilPattern;
  /** Market price per printing. A printing this product doesn't have is absent. */
  prices: Partial<Record<Printing, number>>;
}

/**
 * Bulk buylist tiers. Anything under the value threshold is worth its bulk rate
 * and nothing more, which is the whole reason a box of a cheap set is a bad
 * trade: 350 of the 360 cards in it are these.
 */
export type BulkClass = 'commonUncommon' | 'reverse' | 'rare' | 'doubleRare' | 'hit';

export type BulkRates = Record<BulkClass, number>;

/** Which cards an outcome can draw from. */
export interface PoolSpec {
  /** TCGplayer rarity strings. A card must match one of them. */
  rarities: string[];
  printing: Printing;
  /**
   * `base` (the default) excludes the Poké Ball / Master Ball products, which
   * would otherwise triple the size of every Prismatic Evolutions pool.
   */
  pattern?: FoilPattern | 'base';
  /** Bulk floor applied to every card in the pool. */
  bulk: BulkClass;
}

export interface SlotOutcome {
  label: string;
  /**
   * Probability this slot resolves to this outcome, per pack. Exactly one
   * outcome in a slot omits it and takes the remainder — that is always the
   * boring one (a plain rare, a plain reverse holo).
   */
  chance?: number;
  /** The cards this outcome draws from. Omitted only when `flat` is set. */
  pool?: PoolSpec;
  /**
   * An outcome with no pool: the basic energy that rides along in every
   * Scarlet & Violet pack. Valued at this bulk rate, never more.
   */
  flat?: BulkClass;
}

export interface PackSlot {
  label: string;
  /** Cards drawn from this slot per pack. Defaults to 1. */
  count?: number;
  outcomes: SlotOutcome[];
}

/** A sealed product, and how many packs you have to open to get through it. */
export interface SealedProduct {
  kind: 'box' | 'etb' | 'bundle' | 'pack';
  label: string;
  /** TCGplayer product id. */
  id: number;
  packs: number;
  /** Market price, or null when TCGplayer has no market price for it. */
  price: number | null;
  url: string;
  /**
   * True for the product this set is normally bought by — the booster box,
   * or the Elite Trainer Box for the sets that never got one.
   */
  primary?: boolean;
}

/** Where the pull rates came from, so the page can cite it. */
export interface PullRateSource {
  url: string;
  label: string;
  /** Packs TCGplayer's authentication centre opened to measure the rates. */
  sampleSize: number;
}

/** Where the bulk rates came from. Same idea: every number on the page is cited. */
export interface SourceLink {
  url: string;
  label: string;
}

/** A sealed product before the build resolves its name, price and URL. */
export type SealedProductConfig = Omit<SealedProduct, 'price' | 'url'>;

export interface PackEvSetConfig {
  code: string;
  name: string;
  groupId: number;
  source: PullRateSource;
  sealed: SealedProductConfig[];
  slots: PackSlot[];
}

/** `config/pack-ev.json`, as the builder reads it. */
export interface PackEvConfig {
  threshold: number;
  bulk: BulkRates;
  bulkSource: SourceLink;
  sets: PackEvSetConfig[];
}

export interface OutcomeEv {
  label: string;
  chance: number;
  /** Cards in the pool this outcome draws from. 0 for a flat outcome. */
  poolSize: number;
  /** Mean value of a card from that pool, bulk floor included. */
  averageValue: number;
  /** chance × averageValue × slot count — dollars this outcome adds per pack. */
  contribution: number;
}

export interface SlotEv {
  label: string;
  count: number;
  outcomes: OutcomeEv[];
  contribution: number;
}

export interface PackEv {
  /** Expected dollar value of one pack's contents. */
  perPack: number;
  slots: SlotEv[];
}

/** A single card's share of pack EV, for the "what is actually carrying this" list. */
export interface CardContribution {
  card: PackCard;
  printing: Printing;
  /** Chance this exact card turns up in a given pack. */
  chance: number;
  /** Value it is counted at (market above the threshold, else bulk). */
  value: number;
  /** chance × value. */
  contribution: number;
}

export interface PackEvSetPayload {
  code: string;
  name: string;
  /** TCGCSV group id, the source of both the card list and the sealed prices. */
  groupId: number;
  /** TCGplayer's publish date for the group, YYYY-MM-DD. */
  releasedOn: string | null;
  /** ISO timestamp of the run that built this payload. */
  generatedAt: string;
  source: PullRateSource;
  bulkSource: SourceLink;
  /** Market above this counts at market; at or below it counts as bulk. */
  threshold: number;
  bulk: BulkRates;
  slots: PackSlot[];
  cards: PackCard[];
  sealed: SealedProduct[];
  /** EV as the job computed it, from exactly the fields above. */
  ev: PackEv;
}

/** One row of the index: enough to rank every set without loading its cards. */
export interface PackEvIndexEntry {
  code: string;
  name: string;
  releasedOn: string | null;
  evPerPack: number;
  /** The primary product's cost per pack, or null when it has no market price. */
  costPerPack: number | null;
  primaryLabel: string;
}

export interface PackEvIndex {
  generatedAt: string;
  sets: PackEvIndexEntry[];
}
