export interface PrintVariation {
  set: string;
  number: string;
  price_usd?: number | null;
}

export declare const SET_CATALOG: Array<{ code: string; name: string }>;
export declare const STANDARD_LEGAL_SETS: Set<string>;
export declare const PROMO_SETS: Set<string>;
export declare const BASIC_ENERGY_NAMES: Set<string>;

export declare function getReleaseIndex(setCode: string): number;
export declare function chooseCanonicalPrint(
  variations: PrintVariation[],
  cardName: string
): PrintVariation | null;
