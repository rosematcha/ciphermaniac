/**
 * Reading Limitless's Day 2 decklist database into Set Impact events.
 *
 * Limitless publishes the top of each event, not the field, and how deep it
 * goes varies: a Day 2 of hundreds today, often just a top 8 before 2020.
 * Every event is cut to its top 8, the one depth every era publishes; on
 * events that list deeper, a top 8 tracks the top 5% closely (r = 0.94 per
 * set, no lean either way), only noisier, and averaging hundreds of events
 * takes the noise out.
 * @module shared/setImpact/limitless
 */

import { normalizeCardNumber, type SynonymDatabase } from '../data/cardIdentity';
import type { ImpactDeck, SetWindow } from './build';

/** Limitless card as listed: name, set code, collector number, copies. */
export type LimitlessCard = [name: string, set: string, number: string, count: number];

export interface LimitlessDeck {
  place: number | null;
  cards: LimitlessCard[];
}

export interface LimitlessEventInfo {
  id: number;
  name: string;
  /** Limitless's format slug, e.g. `SSH-BRS` (first and last legal set). */
  format: string | null;
  players: number | null;
  /** ISO date. */
  date: string | null;
  /** Played on the online client; Limitless flags these with a client logo instead of a country. */
  online: boolean;
}

/**
 * The in-person gap: no major from Perth in March 2020 until Brisbane in
 * March 2022. Online events count inside it, as the closest thing the game
 * had, and never outside it.
 */
export const ONLINE_WINDOW = { from: '2020-03-15', until: '2022-03-12' };

/**
 * Standard seasons before regulation marks took over, as the first legal set
 * and the date the rotation to it took effect. Rotations followed Worlds; the
 * dates from 2016 on match Limitless's own format labels (the last PRC-on
 * event is August 2017, the first BKT-on September 2017, and so on). The
 * later rows are the catalog's rotations, named by the format labels.
 */
export const STANDARD_SEASONS: Array<{ from: string; firstSet: string }> = [
  { from: '2008-08-15', firstSet: 'DP' },
  { from: '2010-09-01', firstSet: 'MD' },
  { from: '2011-09-01', firstSet: 'HS' },
  { from: '2012-09-01', firstSet: 'BLW' },
  { from: '2013-09-01', firstSet: 'NXD' },
  { from: '2014-09-01', firstSet: 'BCR' },
  { from: '2015-09-01', firstSet: 'XY' },
  { from: '2016-09-01', firstSet: 'PRC' },
  { from: '2017-09-01', firstSet: 'BKT' },
  { from: '2018-08-31', firstSet: 'SUM' },
  { from: '2019-08-16', firstSet: 'UPR' },
  { from: '2020-08-14', firstSet: 'TEU' },
  { from: '2022-02-25', firstSet: 'SSH' },
  { from: '2023-04-14', firstSet: 'BST' },
  { from: '2024-04-05', firstSet: 'BRS' },
  { from: '2025-04-11', firstSet: 'SVI' },
  { from: '2026-04-10', firstSet: 'TEF' }
];

/**
 * Promo lines, dated by the eras they were printed for. Each card in a line
 * really rotated with its own era's sets; this is the rough span, and it only
 * decides credit (promos never rank), so a promo-only card is recognised as
 * legal rather than making its event look like another format.
 */
export const PROMO_WINDOWS: SetWindow[] = [
  { code: 'DPP', legalFrom: '2007-05-01', legalUntil: '2011-09-01', promo: true },
  { code: 'HSP', legalFrom: '2010-02-01', legalUntil: '2012-09-01', promo: true },
  { code: 'BWP', legalFrom: '2011-04-01', legalUntil: '2015-09-01', promo: true },
  { code: 'XYP', legalFrom: '2014-02-01', legalUntil: '2018-08-31', promo: true },
  { code: 'SMP', legalFrom: '2017-02-01', legalUntil: '2022-02-25', promo: true },
  { code: 'SP', legalFrom: '2019-11-15', legalUntil: '2025-04-11', promo: true }
];

/** The first legal set of the Standard season a date falls in. */
export function seasonFirstSet(date: string): string | null {
  let first: string | null = null;
  for (const season of STANDARD_SEASONS) {
    if (season.from <= date) {
      first = season.firstSet;
    }
  }
  return first;
}

export interface LimitlessSet {
  code: string;
  name: string;
  /** ISO release date; null for promo lines. */
  released: string | null;
}

const DAY_MS = 86_400_000;
const addDays = (iso: string, days: number): string =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** Sets became tournament legal the second Friday after release. */
export function secondFridayAfter(released: string): string {
  const day = new Date(`${released}T00:00:00Z`).getUTCDay();
  const toFriday = (5 - day + 7) % 7 || 7;
  return addDays(released, toFriday + 7);
}

/**
 * Legality windows for every set released before `before` (the first set our
 * catalog dates): legal from its second Friday, and rotated by the first
 * season whose opening set came out after it.
 */
export function eraWindows(sets: LimitlessSet[], before: string): SetWindow[] {
  const released = new Map(sets.map(set => [set.code, set.released]));
  const seasons = STANDARD_SEASONS.map(season => ({ ...season, released: released.get(season.firstSet) ?? null }));
  return sets
    .filter(
      (set): set is LimitlessSet & { released: string } => Boolean(set.released) && (set.released as string) < before
    )
    .map(set => ({
      code: set.code,
      name: set.name,
      legalFrom: secondFridayAfter(set.released),
      legalUntil: seasons.find(season => season.released !== null && season.released > set.released)?.from ?? null
    }))
    .filter(window => window.legalUntil === null || window.legalFrom < window.legalUntil);
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
];

const decode = (text: string): string =>
  text
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

function isoDate(day: string, month: string, year: string): string | null {
  const index = MONTHS.indexOf(month);
  return index < 0 ? null : `${year}-${String(index + 1).padStart(2, '0')}-${day.padStart(2, '0')}`;
}

/** The infobox of a `/tournaments/{id}` page. */
export function parseEventInfo(id: number, html: string): LimitlessEventInfo {
  const heading = /class="infobox-heading">\s*([^<]*?)\s*</.exec(html);
  const flag = /class="infobox-heading">[^]*?<img class="flag"[^>]*alt="([^"]*)"/.exec(html);
  const lineMatch = /infobox-line">([\s\S]*?)<\/div/.exec(html);
  const line = lineMatch ? lineMatch[1].replace(/<[^>]+>|\s+/g, ' ') : '';
  const format = /\/decks\/\?time=all&(?:amp;)?format=([A-Z0-9]+-[A-Z0-9]+)/.exec(html);
  const players = /([\d,]+) Players/.exec(line);
  const when = /(\d+)\w* (\w+) (\d{4})/.exec(line);
  return {
    id,
    name: heading ? decode(heading[1]) : '',
    format: format ? format[1] : null,
    players: players ? Number(players[1].replace(/,/g, '')) : null,
    date: when ? isoDate(when[1], when[2], when[3]) : null,
    online: flag !== null && ONLINE_CLIENTS.has(flag[1].toLowerCase())
  };
}

const ONLINE_CLIENTS = new Set(['ptcgo', 'ptcgl']);

/** A card name as Limitless shows it, markup (the Prism Star glyph's span) removed. */
export const cardName = (html: string): string =>
  decode(html.replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();

const PLACE = /data-target="decklist-\d+">\s*(\d+)(?:st|nd|rd|th)\b/;
const CARD =
  /class="decklist-card" data-set="([^"]*)" data-number="([^"]*)"[\s\S]*?card-count">(\d+)<\/span>\s*<span class="card-name">([\s\S]*?)<\/span>\s*(?:<img|<\/a>)/g;

/** Every list on a `/tournaments/{id}/decklists` page, with its placing. */
export function parseDecklists(html: string): LimitlessDeck[] {
  return html
    .split('<div class="tournament-decklist">')
    .slice(1)
    .map(part => {
      const place = PLACE.exec(part);
      const cards = [...part.matchAll(CARD)].map(([, set, number, count, name]): LimitlessCard => [
        cardName(name),
        set,
        number,
        Number(count)
      ]);
      return { place: place ? Number(place[1]) : null, cards };
    });
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Limitless's `/cards` set list: code, name and release date ("03 Feb 17"). */
export function parseSetList(html: string): LimitlessSet[] {
  return [...html.matchAll(/href="\/cards\/([A-Z0-9-]+)"[^>]*>([\s\S]*?)<\/tr>/g)].map(([, code, body]) => {
    const text = decode(body.replace(/<[^>]+>|\s+/g, ' ')).trim();
    const when = /(\d{2}) (\w{3}) (\d{2})/.exec(text);
    const month = when ? MONTH_ABBR.indexOf(when[2]) : -1;
    return {
      code,
      name: text.split(new RegExp(`\\s${code}(?:\\s|$)`))[0].trim(),
      released: when && month >= 0 ? `20${when[3]}-${String(month + 1).padStart(2, '0')}-${when[1]}` : null
    };
  });
}

/** International printings on a `/cards/{set}/{number}` page, as `SET::NNN`. */
export function parsePrintTable(html: string): string[] {
  const table = /<table class="card-prints-versions">([\s\S]*?)<\/table>/.exec(html);
  if (!table) {
    return [];
  }
  // Japanese printings follow their own header and never reach English play.
  const international = table[1].split(/<th>JP\. Prints<\/th>/)[0];
  return [...international.matchAll(/href="\/cards\/([A-Z0-9-]+)\/([^"/]+)"/g)].map(
    ([, set, number]) => `${set}::${normalizeCardNumber(number)}`
  );
}

/**
 * A Standard major we can place: dated, sized, in person (or online inside
 * the in-person gap), and either labelled with the season's own format (a
 * BLW-on label mid-2018 is Expanded) or, for the unlabelled events before
 * Limitless began labelling in late 2016, dated inside a known season.
 */
export function isStandardEvent(info: LimitlessEventInfo, today: string): boolean {
  if (!info.date || info.date > today || !info.players) {
    return false;
  }
  if (info.online && (info.date < ONLINE_WINDOW.from || info.date >= ONLINE_WINDOW.until)) {
    return false;
  }
  const expected = seasonFirstSet(info.date);
  if (!info.format) {
    return info.date < LABELLED_SINCE && expected !== null;
  }
  return info.format.split('-')[0] === expected;
}

/** Limitless labels every event's format from this date. */
const LABELLED_SINCE = '2016-09-01';

/** Every era publishes at least its top 8. */
export const TOP_CUT = 8;

/** The lists placing in the top cut, or null when the event doesn't list all of them. */
export function cutToTop(decks: LimitlessDeck[], cut = TOP_CUT): LimitlessDeck[] | null {
  const kept = decks.filter(deck => deck.place !== null && deck.place <= cut);
  return kept.length >= cut ? kept : null;
}

/** Limitless decks in the shape the Set Impact builder reads. */
export function toImpactDecks(decks: LimitlessDeck[]): ImpactDeck[] {
  return decks.map(deck => ({ cards: deck.cards.map(([name, set, number]) => ({ name, set, number })) }));
}

/**
 * Our synonym database, with printings Limitless lists for cards it doesn't
 * know folded in. `found` maps a card's UID to the `SET::NNN` printings its
 * print table lists. A cluster that touches a known card joins that card's
 * canonical; a new one is keyed on its first printing.
 */
export function extendSynonyms(db: SynonymDatabase, found: Map<string, string[]>): SynonymDatabase {
  const synonyms = { ...db.synonyms };
  const canonicals = new Set(Object.values(db.synonyms));
  const canonicalOf = (uid: string): string => synonyms[uid] ?? uid;
  for (const [uid, prints] of found) {
    const name = uid.split('::')[0];
    const members = [uid, ...prints.map(print => `${name}::${print}`)];
    const known = members.find(member => member in synonyms || canonicals.has(member));
    const canonical = canonicalOf(known ?? members[0]);
    canonicals.add(canonical);
    for (const member of members) {
      if (member !== canonical && !(member in synonyms)) {
        synonyms[member] = canonical;
      }
    }
  }
  return { ...db, synonyms };
}
