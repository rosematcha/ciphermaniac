export interface PrintVariation {
  set: string;
  number: string;
  price_usd?: number | null;
}

export interface ChooseCanonicalPrintOptions {
  asOfDate?: string | null;
}

export declare const SET_CATALOG: Array<{
  code: string;
  name: string;
  legalFrom?: string;
  legalUntil?: string | null;
}>;
export declare const STANDARD_LEGAL_SETS: Set<string>;
export declare const PROMO_SETS: Set<string>;
export declare const BASIC_ENERGY_NAMES: Set<string>;

export declare function getReleaseIndex(setCode: string): number;
export declare function isSetLegalAt(setCode: string | null | undefined, asOfDate: string): boolean;
export declare function chooseCanonicalPrint(
  variations: PrintVariation[],
  cardName: string,
  options?: ChooseCanonicalPrintOptions
): PrintVariation | null;
