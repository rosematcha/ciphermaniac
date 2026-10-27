/**
 * A format's ban list, published beside its report as `banlist.json`.
 * @module shared/formats/banlist
 */

/** File name of a format's ban list inside its report folder. */
export const BANLIST_FILE = 'banlist.json';

/** One banned print, in our card identity. */
export interface BannedPrint {
  name: string;
  set: string;
  number: string;
}

export interface FormatBanlist {
  /** Where the list was read from. */
  source: string;
  fetchedAt: string;
  prints: BannedPrint[];
}
