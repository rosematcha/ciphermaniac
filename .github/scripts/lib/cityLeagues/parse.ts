/**
 * Parsers for the Limitless City League pages. Each takes the page's HTML and
 * returns plain data; nothing here fetches. Fixtures of every page live in
 * tests/fixtures/city-leagues.
 */
import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import type { CityLeagueList, EventPlacing, JpCardPrints, ListCard, ListingPage, ListingRow, PrintRef } from './types';

/** A selection as `$(...)` returns it. */
type Selection = ReturnType<CheerioAPI>;

const EVENT_HREF = /\/tournaments\/jp\/(\d+)/;
const LIST_HREF = /\/decks\/list\/jp\/(\d+)/;
const PLAYER_HREF = /\/players\/jp\/([^/?#]+)/;
const OFFICIAL_HREF = /players\.pokemon-card\.com\/event\/detail\/(\d+)/;
const JP_CARD_HREF = /\/cards\/jp\/([A-Za-z0-9-]+)\/([A-Za-z0-9]+)/;
const EN_CARD_HREF = /\/cards\/(?:en\/)?([A-Za-z0-9]+)\/([A-Za-z0-9]+)/;

function matchGroup(pattern: RegExp, value: string | undefined): string | null {
  return pattern.exec(value ?? '')?.[1] ?? null;
}

/**
 * One page of `/tournaments/jp`, newest event first.
 * @param html - The listing page
 * @returns The page's events and the last page number
 */
export function parseListingPage(html: string): ListingPage {
  const $ = cheerio.load(html);
  const rows: ListingRow[] = [];
  $('tr[data-date]').each((_, element) => {
    const row = $(element);
    const id = matchGroup(EVENT_HREF, row.find('a[href*="/tournaments/jp/"]').attr('href'));
    const date = row.attr('data-date') ?? '';
    if (id && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      rows.push({ id, date, prefecture: row.attr('data-city') ?? '', shop: row.attr('data-shop') ?? '' });
    }
  });
  const maxPage = Number($('ul.pagination').attr('data-max')) || 1;
  return { rows, maxPage };
}

function parsePlacingRow($: CheerioAPI, cells: Selection): EventPlacing | null {
  const placing = Number(cells.eq(0).text().trim());
  if (!Number.isInteger(placing) || placing < 1) {
    return null;
  }
  const playerLink = cells.eq(1).find('a');
  const listHref = cells.find('a[href*="/decks/list/jp/"]').attr('href');
  const icons = cells
    .eq(2)
    .find('img.pokemon')
    .map((_, img) => $(img).attr('alt') ?? '')
    .get()
    .filter(Boolean);
  return {
    placing,
    player: (playerLink.text() || cells.eq(1).text()).trim() || 'Unknown Player',
    playerId: matchGroup(PLAYER_HREF, playerLink.attr('href')),
    listId: matchGroup(LIST_HREF, listHref),
    icons
  };
}

/**
 * An event page: its heading, the official result it links, and its placings.
 * @param html - `/tournaments/jp/{id}`
 * @returns Name, official id and placings in finishing order
 */
export function parseEventPage(html: string): { name: string; officialId: string | null; placings: EventPlacing[] } {
  const $ = cheerio.load(html);
  const placings: EventPlacing[] = [];
  $('main table.data-table tr').each((_, element) => {
    const cells = $(element).children('td');
    const placing = cells.length >= 3 ? parsePlacingRow($, cells) : null;
    if (placing) {
      placings.push(placing);
    }
  });
  placings.sort((first, second) => first.placing - second.placing);
  return {
    name: $('.infobox-heading').first().text().trim(),
    officialId: matchGroup(OFFICIAL_HREF, $('a[href*="players.pokemon-card.com"]').attr('href')),
    placings
  };
}

function categoryOf(heading: string): ListCard['category'] {
  const lower = heading.toLowerCase();
  if (lower.startsWith('pok')) {
    return 'pokemon';
  }
  return lower.startsWith('energy') ? 'energy' : 'trainer';
}

function parseListCard(card: Selection, category: ListCard['category']): ListCard | null {
  const count = Number(card.find('.card-count').first().text().trim());
  const set = card.attr('data-set')?.trim() ?? '';
  const number = card.attr('data-number')?.trim() ?? '';
  if (!Number.isInteger(count) || count < 1 || !set || !number) {
    return null;
  }
  const href = card.find('a.card-link').attr('href') ?? '';
  return {
    count,
    name: card.find('.card-name').first().text().trim() || 'Unknown Card',
    set,
    number,
    category,
    jp: JP_CARD_HREF.test(href)
  };
}

/**
 * A decklist page. Japanese-only cards are the lines Limitless links to its
 * Japanese card pages (`/cards/jp/M6/62`): they carry a Japanese set code and
 * a provisional English name.
 * @param html - `/decks/list/jp/{id}`
 * @param id - The list id
 * @returns The list's cards in page order
 */
export function parseDecklistPage(html: string, id: string): CityLeagueList {
  const $ = cheerio.load(html);
  const cards: ListCard[] = [];
  $('[data-text-decklist] .decklist-column').each((_, element) => {
    const column = $(element);
    const category = categoryOf(column.find('.decklist-column-heading').first().text().trim());
    column.find('.decklist-card').each((__, cardElement) => {
      const card = parseListCard($(cardElement), category);
      if (card) {
        cards.push(card);
      }
    });
  });
  return { id, cards };
}

function printFromRow(
  $: CheerioAPI,
  row: Selection,
  self: PrintRef
): { section: 'int' | 'jp'; print: PrintRef } | null {
  const link = row.find('a').first();
  const href = link.attr('href');
  const jp = JP_CARD_HREF.exec(href ?? '');
  if (jp) {
    return { section: 'jp', print: { set: jp[1], number: jp[2] } };
  }
  const en = EN_CARD_HREF.exec(href ?? '');
  if (en) {
    return { section: 'int', print: { set: en[1], number: en[2] } };
  }
  // The page's own print is the one row with no link.
  return row.hasClass('current') && link.length ? { section: 'jp', print: self } : null;
}

/**
 * The prints table of a Japanese card page. The English prints come first,
 * under "Int. Prints"; the Japanese ones follow under "JP. Prints".
 * @param html - `/cards/jp/{set}/{number}`
 * @param self - The print the page is for
 * @returns English and Japanese prints of the card
 */
export function parseJpCardPrints(html: string, self: PrintRef): JpCardPrints {
  const $ = cheerio.load(html);
  const result: JpCardPrints = { international: [], japanese: [] };
  $('table.card-prints-versions tr').each((_, element) => {
    const found = printFromRow($, $(element), self);
    if (found?.section === 'int') {
      result.international.push(found.print);
    } else if (found) {
      result.japanese.push(found.print);
    }
  });
  return result;
}

/**
 * The card name on a Limitless card page.
 * @param html - Any `/cards/...` page
 * @returns The name, or null when the page has none
 */
export function parseCardName(html: string): string | null {
  const $ = cheerio.load(html);
  const name = $('.card-text-name').first().text().trim();
  return name || null;
}
