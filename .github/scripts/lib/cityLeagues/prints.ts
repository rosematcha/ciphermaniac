/**
 * Japanese print → English print. A card that exists only in Japanese keeps
 * its Japanese identity (`JP-M6` #62, provisional English name) until
 * Limitless lists an English print for it under "Int. Prints". From then on
 * every list, cached ones included, resolves it to the English card, because
 * the flip happens here at build time and not in the cached lists.
 */
import { PROMO_SETS } from '../../../../shared/data/canonicalPrint';
import { japanOnlySetCode } from '../../../../shared/data/japanOnlyCards';
import { parseCardName, parseJpCardPrints } from './parse';
import type { EnglishPrint, JpPrintMap, JpPrintRecord, PrintRef } from './types';

export const LIMITLESS_ORIGIN = 'https://limitlesstcg.com';

const DAY_MS = 86_400_000;

export function emptyPrintMap(updatedAt = ''): JpPrintMap {
  return { schemaVersion: 1, updatedAt, prints: {} };
}

export function printKey(print: PrintRef): string {
  return `${print.set}/${print.number}`;
}

function numberValue(number: string): number {
  const digits = Number.parseInt(number, 10);
  return Number.isFinite(digits) ? digits : Number.POSITIVE_INFINITY;
}

function byNumber(first: PrintRef, second: PrintRef): number {
  return numberValue(first.number) - numberValue(second.number);
}

/**
 * The Japanese print that stands for the card: the lowest number among its
 * prints in the same set. Prints in other sets (promos, reprints) stay apart,
 * as English reprints do.
 */
export function canonicalJpNumber(self: PrintRef, japanese: PrintRef[]): string {
  const sameSet = japanese.filter(print => print.set === self.set);
  return [self, ...sameSet].sort(byNumber)[0].number;
}

/**
 * The English print a card flips to: a set print before a promo, then the
 * lowest number, which is the regular rarity before any secret rare.
 */
export function pickEnglishPrint(international: PrintRef[]): PrintRef | null {
  const ranked = [...international].sort(
    (first, second) =>
      Number(PROMO_SETS.has(first.set.toUpperCase())) - Number(PROMO_SETS.has(second.set.toUpperCase())) ||
      byNumber(first, second)
  );
  return ranked[0] ?? null;
}

interface ResolvableCard {
  set: string;
  number: string;
  name: string;
}

/**
 * The identity a Japanese list card is counted under: its English print once
 * there is one, else its canonical Japanese print under a `JP-` set code.
 * @param card - A list card Limitless linked to its Japanese card page
 * @param map - The print map
 * @returns Set, number and name to store on the deck
 */
export function resolveJpCard(card: ResolvableCard, map: JpPrintMap): ResolvableCard {
  const record = map.prints[printKey(card)];
  const canonicalNumber = record?.canonicalNumber ?? card.number;
  const canonical = map.prints[printKey({ set: card.set, number: canonicalNumber })];
  const en = canonical?.en ?? record?.en ?? null;
  if (en) {
    return { set: en.set, number: en.number, name: en.name };
  }
  const name = canonical?.name ?? record?.name ?? card.name;
  return { set: japanOnlySetCode(card.set), number: canonicalNumber, name };
}

function needsCheck(record: JpPrintRecord | undefined, today: string, recheckDays: number): boolean {
  if (!record) {
    return true;
  }
  if (record.en) {
    return false;
  }
  return Date.parse(today) - Date.parse(record.checkedAt) >= recheckDays * DAY_MS;
}

type FetchText = (url: string) => Promise<string>;

async function englishPrintOf(international: PrintRef[], fetchText: FetchText): Promise<EnglishPrint | null> {
  const pick = pickEnglishPrint(international);
  if (!pick) {
    return null;
  }
  // The Japanese page carries Limitless's own translation; the official
  // English name is on the English print's page.
  const name = parseCardName(await fetchText(`${LIMITLESS_ORIGIN}/cards/en/${pick.set}/${pick.number}`));
  return name ? { set: pick.set.toUpperCase(), number: pick.number, name } : null;
}

async function checkPrint(print: PrintRef, fetchText: FetchText, today: string): Promise<JpPrintRecord> {
  // `translate=en` names the card in Limitless's provisional English.
  const html = await fetchText(`${LIMITLESS_ORIGIN}/cards/jp/${print.set}/${print.number}?translate=en`);
  const prints = parseJpCardPrints(html, print);
  return {
    canonicalNumber: canonicalJpNumber(print, prints.japanese),
    name: parseCardName(html),
    en: await englishPrintOf(prints.international, fetchText),
    checkedAt: today
  };
}

export interface RefreshPrintMapOptions {
  map: JpPrintMap;
  /** Japanese prints seen in the window's lists. */
  prints: PrintRef[];
  fetchText: FetchText;
  /** `YYYY-MM-DD`. */
  today: string;
  /** Days before an unreleased print's page is read again. Released prints are never re-read. */
  recheckDays: number;
}

/**
 * Read the card page of every Japanese print that is new or due a recheck, and
 * record its canonical print and any English print. A failed read leaves the
 * print as it was; it is retried on the next run.
 * @param options - Map, prints, fetcher and schedule
 * @returns Number of pages read and of prints that flipped to English
 */
export async function refreshPrintMap(options: RefreshPrintMapOptions): Promise<{ checked: number; flipped: number }> {
  const { map, fetchText, today, recheckDays } = options;
  const unique = new Map(options.prints.map(print => [printKey(print), print]));
  let checked = 0;
  let flipped = 0;
  for (const [key, print] of unique) {
    if (!needsCheck(map.prints[key], today, recheckDays)) {
      continue;
    }
    try {
      const record = await checkPrint(print, fetchText, today);
      checked += 1;
      flipped += record.en ? 1 : 0;
      map.prints[key] = record;
    } catch (error) {
      console.warn(`[city-leagues] could not read prints for ${key}: ${String(error)}`);
    }
  }
  if (checked) {
    map.updatedAt = today;
  }
  return { checked, flipped };
}
