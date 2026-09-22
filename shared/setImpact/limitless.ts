/**
 * Reading Limitless's Day 2 decklist database into Set Impact events.
 *
 * Limitless publishes the top of each event, not the field, and how deep it
 * goes varies (Bilbao 2022 lists 31 of 276 players, Baltimore 2026 559 of
 * 3,122). Shares taken over those lists as-is would compare an elite slice at
 * one event with a broad one at the next, so every event is cut to the same
 * placement percentile, and an event whose lists don't reach it is left out.
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
}

/**
 * Sun & Moon sets still legal when the first Sword & Shield sets came out, so
 * a Sword & Shield reprint of one of their cards is not new to Standard. The
 * rotations match Limitless's format labels: UPR-on events run to August
 * 2020, TEU-on to the start of 2022, and SSH-on from March 2022.
 */
export const SUN_MOON_WINDOWS: SetWindow[] = [
  ...['UPR', 'FLI', 'CES', 'DRM', 'LOT'].map(code => ({ code, legalFrom: '2018-02-02', legalUntil: '2020-08-14' })),
  ...['TEU', 'DET', 'UNB', 'UNM', 'HIF', 'CEC'].map(code => ({
    code,
    legalFrom: '2019-02-01',
    legalUntil: '2022-02-25'
  }))
];

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
    .replace(/&#0?39;|&apos;/g, "'")
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
    date: when ? isoDate(when[1], when[2], when[3]) : null
  };
}

const PLACE = /data-target="decklist-\d+">\s*(\d+)(?:st|nd|rd|th)\b/;
const CARD =
  /class="decklist-card" data-set="([^"]*)" data-number="([^"]*)"[\s\S]*?card-count">(\d+)<\/span>\s*<span class="card-name">([^<]*)<\/span>/g;

/** Every list on a `/tournaments/{id}/decklists` page, with its placing. */
export function parseDecklists(html: string): LimitlessDeck[] {
  return html
    .split('<div class="tournament-decklist">')
    .slice(1)
    .map(part => {
      const place = PLACE.exec(part);
      const cards = [...part.matchAll(CARD)].map(([, set, number, count, name]): LimitlessCard => [
        decode(name),
        set,
        number,
        Number(count)
      ]);
      return { place: place ? Number(place[1]) : null, cards };
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

/** Should an event count at all: a dated, sized, international-format major. */
export function isEligible(info: LimitlessEventInfo, isDatedSet: (code: string) => boolean, today: string): boolean {
  const firstSet = info.format?.split('-')[0];
  return Boolean(
    info.date && info.date <= today && info.players && firstSet && isDatedSet(firstSet) && !/online/i.test(info.name)
  );
}

export interface DepthOptions {
  /** Share of the field kept at every event, by placing. */
  depth: number;
  /** An event must keep at least this many lists. */
  minDecks: number;
  /** Share of the kept placings that must have a list. */
  minCoverage: number;
}

/**
 * The lists placing inside the top `depth` of the field, or null when the
 * event's lists don't reach that deep (or leave too many of those placings
 * without a list) and the event has to be left out.
 */
export function cutToDepth(decks: LimitlessDeck[], players: number, options: DepthOptions): LimitlessDeck[] | null {
  const cut = Math.ceil(players * options.depth);
  if (cut < options.minDecks) {
    return null;
  }
  const kept = decks.filter(deck => deck.place !== null && deck.place <= cut);
  return kept.length >= cut * options.minCoverage ? kept : null;
}

/** Limitless decks in the shape the Set Impact builder reads. */
export function toImpactDecks(decks: LimitlessDeck[]): ImpactDeck[] {
  return decks.map(deck => ({
    placement: deck.place,
    cards: deck.cards.map(([name, set, number]) => ({ name, set, number }))
  }));
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
