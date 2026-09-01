/**
 * Reading the cells of a Limitless player results table.
 *
 * Split out of the crawler because the cash column is the one field with a
 * non-obvious format and no feedback when it is read wrong: Limitless
 * abbreviates thousands, so `2.5K$` means $2,500. A parser that merely strips
 * non-digits returns 25 and every career total is quietly two orders of
 * magnitude short.
 * @module shared/earningsParse
 */

/** `750$`, `2.5K$`, `10K$` — optionally with the symbol leading instead. */
const CASH = /^\$?([\d,]+(?:\.\d+)?)\s*(k)?\s*\$?$/i;

/**
 * Prize money in whole dollars. An empty cell is $0 — most rows pay nothing.
 *
 * Throws on anything else rather than returning 0: a silent zero on an
 * unrecognized format is indistinguishable from a genuine non-cashing finish,
 * and the crawl is resumable, so stopping loudly costs nothing.
 */
export function parseCash(text: string): number {
  const cleaned = text.trim();
  if (!cleaned) {
    return 0;
  }
  const match = CASH.exec(cleaned);
  const value = match ? Number(match[1].replace(/,/g, '')) : Number.NaN;
  if (!Number.isFinite(value)) {
    throw new Error(`Unrecognized cash value ${JSON.stringify(text)} — the Limitless format changed`);
  }
  return Math.round(match?.[2] ? value * 1000 : value);
}

/** `21st` is 21. Null when the cell carries no placement. */
export function parsePlace(text: string): number | null {
  const digits = /^(\d+)/.exec(text.trim());
  return digits ? Number(digits[1]) : null;
}

/** The `Season 2019-2020` sub-heading becomes the key `1920`. */
export function parseSeasonKey(text: string): string | null {
  const span = /(\d{4})\D+(\d{4})/.exec(text);
  return span ? `${span[1].slice(2)}${span[2].slice(2)}` : null;
}

/**
 * Ids already captured by a previous crawl, from the NDJSON results file.
 *
 * A process killed mid-append can leave a torn final line. It is reported
 * rather than thrown on: the id it belonged to simply gets fetched again, and
 * the caller rewrites the file without it so later readers see clean JSON.
 */
export function parseCrawledIds(ndjson: string): { ids: Set<string>; lines: string[]; torn: number } {
  const ids = new Set<string>();
  const lines: string[] = [];
  let torn = 0;
  for (const line of ndjson.split('\n')) {
    if (!line.trim()) {
      continue;
    }
    try {
      const { id } = JSON.parse(line) as { id?: string };
      if (typeof id !== 'string') {
        throw new Error('missing id');
      }
      ids.add(id);
      lines.push(line);
    } catch {
      torn += 1;
    }
  }
  return { ids, lines, torn };
}
