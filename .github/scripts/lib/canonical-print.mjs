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

// Unknown sets are treated as newest: they are either brand-new sets missing
// from the catalog or oddball products, and neither should win "oldest".
const UNKNOWN_SET_INDEX = -1;

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
 * @param {Array<{set: string, number: string, price_usd?: number|null}>} variations
 * @param {string} cardName
 * @returns {{set: string, number: string, price_usd?: number|null}|null}
 */
export function chooseCanonicalPrint(variations, cardName) {
    if (!variations || !variations.length) return null;

    // 1. Standard legality. If nothing is legal (a fully rotated card in
    //    historical data), fall back to every print.
    const legal = variations.filter(v => STANDARD_LEGAL_SETS.has((v.set || '').toUpperCase()));
    let pool = legal.length ? legal : [...variations];

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
