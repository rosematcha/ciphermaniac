import * as cheerio from 'cheerio';
import { SET_CATALOG } from '../../../shared/data/canonicalPrint.ts';

/** How long after a set turns legal its whole card list keeps seeding the synonyms scrape. */
export const NEW_SET_SEED_DAYS = 90;

const DAY_MS = 86_400_000;

/**
 * Sets new enough that most of their cards have never been played: legal
 * within the last `days`, or not legal yet. Deck data alone never asks
 * Limitless about an unplayed card, so these sets are scraped card by card.
 * @param today - ISO date (YYYY-MM-DD)
 * @param days - The seeding window
 * @returns Set codes, newest first
 */
export function newSetCodes(today: string, days = NEW_SET_SEED_DAYS): string[] {
  const cutoff = new Date(Date.parse(today) - days * DAY_MS).toISOString().slice(0, 10);
  return SET_CATALOG.filter(entry => entry.legalFrom !== undefined && entry.legalFrom >= cutoff).map(
    entry => entry.code
  );
}

/**
 * Every card on a Limitless set page rendered with `?display=list`.
 * @param html - The page
 * @param setCode - The set the page lists
 * @returns Name and number per card, in page order
 */
export function parseSetCardList(html: string, setCode: string): { name: string; number: string }[] {
  const $ = cheerio.load(html);
  const prefix = `/cards/${setCode}/`;
  const cards: { name: string; number: string }[] = [];
  $('tr').each((_, row) => {
    const links = $(row)
      .find('td > a')
      .filter((__, link) => ($(link).attr('href') ?? '').startsWith(prefix));
    if (links.length < 2) {
      return;
    }
    const number = $(links[0]).text().trim();
    const name = $(links[1]).text().trim();
    if (number && name) {
      cards.push({ name, number });
    }
  });
  return cards;
}
