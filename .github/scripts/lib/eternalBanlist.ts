/**
 * The Eternal ban list, from the Cube Koga cube Eternal's organizers maintain.
 *
 * Cube Koga names cards by pokemontcg.io id (`dp6-28`) and set name, so prints
 * are mapped to our set codes through the set catalog's names, plus aliases for
 * the handful of names the two sources spell differently.
 */

import { SET_CATALOG } from '../../../shared/data/canonicalPrint';
import type { BannedPrint, FormatBanlist } from '../../../shared/formats/banlist';

export const BANLIST_CUBE_URL = 'https://cubekoga.net/api/cubes/16765/cards';

/** Cube Koga set names that differ from the set catalog's. */
const SET_ALIASES: Readonly<Record<string, string>> = {
  base: 'BS',
  'expedition base set': 'E1',
  'hs—triumphant': 'TM',
  'hs—undaunted': 'UD',
  'hgss black star promos': 'HSP',
  'sm black star promos': 'SMP',
  'swsh black star promos': 'SP',
  'wizards black star promos': 'WP'
};

const CODE_BY_NAME = new Map(SET_CATALOG.map(entry => [entry.name.toLowerCase(), entry.code]));

/** The fields of a Cube Koga card the list reads. */
interface CubeCard {
  card_ID?: unknown;
  card_Name?: unknown;
  set?: unknown;
}

function setCode(setName: string): string | null {
  const key = setName.toLowerCase();
  return SET_ALIASES[key] ?? CODE_BY_NAME.get(key) ?? null;
}

/** The card number inside a pokemontcg.io id, without a promo prefix or padding: `swshp-SWSH050` is 50. */
function cardNumber(id: string): string {
  const raw = id.slice(id.lastIndexOf('-') + 1);
  return raw.replace(/^[A-Za-z]+(?=\d)/, '').replace(/^0+(?=.)/, '');
}

/**
 * Map Cube Koga's cards to banned prints.
 * @returns The prints, and the cards whose set could not be mapped
 */
export function parseBanlist(cards: unknown): { prints: BannedPrint[]; unmapped: string[] } {
  if (!Array.isArray(cards)) {
    throw new Error('Cube Koga ban list: expected an array of cards');
  }
  const prints: BannedPrint[] = [];
  const unmapped: string[] = [];
  for (const card of cards as CubeCard[]) {
    const { card_ID: id, card_Name: name, set } = card;
    const code = typeof set === 'string' ? setCode(set) : null;
    if (typeof id !== 'string' || typeof name !== 'string' || !code) {
      unmapped.push(`${String(name)} (${String(set)})`);
      continue;
    }
    prints.push({ name, set: code, number: cardNumber(id) });
  }
  return { prints, unmapped };
}

/**
 * Fetch and map the current ban list. Throws when the list can't be read or any
 * card can't be mapped, so a partial list is never published as the whole one.
 * @param fetchJson - Reads a URL as JSON
 * @param now - The run's clock
 */
export async function fetchEternalBanlist(
  fetchJson: (url: string) => Promise<unknown>,
  now: Date
): Promise<FormatBanlist> {
  const { prints, unmapped } = parseBanlist(await fetchJson(BANLIST_CUBE_URL));
  if (unmapped.length) {
    throw new Error(`Eternal ban list has cards in unknown sets: ${unmapped.join(', ')}`);
  }
  return { source: BANLIST_CUBE_URL, fetchedAt: now.toISOString(), prints };
}
