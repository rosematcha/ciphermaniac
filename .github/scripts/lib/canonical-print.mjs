/**
 * Canonical print selection shared by the synonym pipeline scripts.
 *
 * The goal is the print a player would actually buy for a standard deck:
 * the oldest standard-legal print that is still cheap, skipping high-rarity
 * reprints (secret rares, gold energies) and hard-to-find promos. Basic
 * energies invert the age rule: they are worthless, so we take the newest
 * cheap print instead.
 *
 * Mirror of choose_canonical_print in download-tournament.py — keep the two
 * implementations in sync.
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const CATALOG = JSON.parse(readFileSync(join(__dirname, '../data/set-catalog.json'), 'utf-8'));

export const SET_CATALOG = CATALOG.sets;
export const STANDARD_LEGAL_SETS = new Set(CATALOG.standardLegalSets);
export const PROMO_SETS = new Set(CATALOG.promoSets);
export const BASIC_ENERGY_NAMES = new Set(CATALOG.basicEnergyNames);

// sets is ordered newest-first, so a larger index means an older set.
const SET_RELEASE_INDEX = new Map(SET_CATALOG.map((entry, index) => [entry.code, index]));

const SET_BY_CODE = new Map(SET_CATALOG.map(entry => [entry.code, entry]));

// Unknown sets are treated as newest: they are either brand-new sets missing
// from the catalog or oddball products, and neither should win "oldest".
const UNKNOWN_SET_INDEX = -1;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Was the set standard-legal on the given ISO date? Window is [legalFrom, legalUntil).
 * @param {string|null|undefined} setCode
 * @param {string} asOfDate
 * @returns {boolean}
 */
export function isSetLegalAt(setCode, asOfDate) {
    const entry = setCode ? SET_BY_CODE.get(setCode.toUpperCase()) : undefined;
    if (!entry?.legalFrom || entry.legalFrom > asOfDate) return false;
    return entry.legalUntil == null || asOfDate < entry.legalUntil;
}

// A print "existed" on a date unless its set is dated and became legal only
// later. Undated sets are pre-era products that certainly existed already.
function printExistedAt(setCode, asOfDate) {
    const entry = setCode ? SET_BY_CODE.get(setCode.toUpperCase()) : undefined;
    return !entry?.legalFrom || entry.legalFrom <= asOfDate;
}

export function getReleaseIndex(setCode) {
    if (!setCode) return UNKNOWN_SET_INDEX;
    const upper = setCode.toUpperCase();
    return SET_RELEASE_INDEX.has(upper) ? SET_RELEASE_INDEX.get(upper) : UNKNOWN_SET_INDEX;
}

function normalizePrice(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0
        ? value
        : null;
}

// A print is "accessible" when it costs no more than twice the cheapest
// print, with $0.50 of absolute slack so penny-priced cards do not strike
// prints over noise. Anything above the cap is a collector version.
function accessiblePriceCap(minPrice) {
    return Math.max(minPrice * 2, minPrice + 0.5);
}

function numberSortKey(number) {
    const match = /^(\d+)([A-Za-z]*)$/.exec(String(number ?? ''));
    if (!match) return [Number.MAX_SAFE_INTEGER, String(number ?? '')];
    return [parseInt(match[1], 10), match[2].toUpperCase()];
}

function compareKeys(a, b) {
    for (let i = 0; i < a.length; i++) {
        if (a[i] < b[i]) return -1;
        if (a[i] > b[i]) return 1;
    }
    return 0;
}

/**
 * Pick the canonical print from a cluster of print variations.
 *
 * With `options.asOfDate` (ISO YYYY-MM-DD), standard legality is evaluated on
 * that date instead of today's standardLegalSets — the rolling canonical for a
 * historical event uses the event's start date. Prints from sets not yet legal
 * on the date are treated as nonexistent. Prices remain today's scrape; the
 * accessibility rule is kept as an approximation.
 *
 * @param {Array<{set: string, number: string, price_usd?: number|null}>} variations
 * @param {string} cardName
 * @param {{asOfDate?: string|null}} [options]
 * @returns {{set: string, number: string, price_usd?: number|null}|null}
 */
export function chooseCanonicalPrint(variations, cardName, options) {
    if (!variations || !variations.length) return null;

    const asOfDate = options?.asOfDate ?? null;
    if (asOfDate !== null && !ISO_DATE.test(asOfDate)) {
        throw new Error(`chooseCanonicalPrint: invalid asOfDate "${asOfDate}" (expected YYYY-MM-DD)`);
    }

    // 1. Standard legality, on the event date when one is given. If nothing is
    //    legal (a fully rotated card in historical data), fall back to every
    //    print that existed on the date.
    let pool;
    if (asOfDate !== null) {
        const legal = variations.filter(v => isSetLegalAt(v.set, asOfDate));
        if (legal.length) {
            pool = legal;
        } else {
            const existing = variations.filter(v => printExistedAt(v.set, asOfDate));
            pool = existing.length ? existing : [...variations];
        }
    } else {
        const legal = variations.filter(v => STANDARD_LEGAL_SETS.has((v.set || '').toUpperCase()));
        pool = legal.length ? legal : [...variations];
    }

    // 2. Accessibility. Strike collector-priced prints, and prints with no
    //    price at all when priced alternatives exist.
    const prices = pool.map(v => normalizePrice(v.price_usd)).filter(p => p !== null);
    if (prices.length) {
        const cap = accessiblePriceCap(Math.min(...prices));
        const affordable = pool.filter(v => {
            const price = normalizePrice(v.price_usd);
            return price !== null && price <= cap;
        });
        if (affordable.length) pool = affordable;
    }

    // 3. Prefer non-promo prints; promos stay only for promo-only cards.
    const nonPromo = pool.filter(v => !PROMO_SETS.has((v.set || '').toUpperCase()));
    if (nonPromo.length) pool = nonPromo;

    // 4. Basic energies take the newest remaining print, everything else the
    //    oldest. Ties break by lower price, then lower collector number.
    const wantNewest = BASIC_ENERGY_NAMES.has(cardName);
    const sortKey = v => {
        const index = getReleaseIndex(v.set);
        const price = normalizePrice(v.price_usd);
        return [
            wantNewest ? index : -index,
            price === null ? Number.POSITIVE_INFINITY : price,
            ...numberSortKey(v.number)
        ];
    };

    return pool.reduce((best, v) => (compareKeys(sortKey(v), sortKey(best)) < 0 ? v : best));
}
