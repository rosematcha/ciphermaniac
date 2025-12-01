import { normalizeCardNumber } from './card/routing.js';
import { normalizeSetCode } from './utils/filterState.js';

interface Variant {
    set?: string;
    number?: string | number;
}

interface Overrides {
    [key: string]: string;
}

function sanitizePrimary(name: string): string {
    // Normalize and keep Unicode letters/numbers, apostrophes, dashes, underscores; spaces -> underscores
    const sanitized = String(name)
        .normalize('NFC')
        .replace(/\u2019/g, "'") // curly to straight apostrophe
        .replace(/[:!,]/g, '')
        .replace(/\s+/g, '_')
        .replace(/[^\p{L}\p{N}_\-'.]/gu, '_')
        .replace(/_+/g, '_');
    return sanitized;
}

function sanitizeNoApostrophes(name: string): string {
    return sanitizePrimary(name).replace(/'/g, '');
}

function sanitizeStripPossessive(name: string): string {
    // Turn "X's_Y" into "Xs_Y" (remove apostrophe before s)
    return sanitizePrimary(name).replace(/'s_/gi, 's_').replace(/'s\./gi, 's.').replace(/'/g, '');
}

function asciiFold(name: string): string {
    // Remove diacritics
    return name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .normalize('NFC');
}

function teamRocketVariants(name: string): string[] {
    const variants: string[] = [];
    if (/Team Rocket's/i.test(name)) {
        variants.push(name.replace(/Team Rocket's/gi, "Team Rocket's")); // normalized
        variants.push(name.replace(/Team Rocket's/gi, 'Team Rockets'));
    }
    return variants;
}

function appendCandidate(list: string[], base: string, relative: string): void {
    if (!relative) {
        return;
    }
    const trimmed = relative.startsWith('/') ? relative.slice(1) : relative;
    const fullPath = `${base}${trimmed}`;
    if (!list.includes(fullPath)) {
        list.push(fullPath);
    }
}

function getVariantOverride(overrides: Overrides | undefined, name: string, setCode: string, number: string): string | null {
    if (!overrides) {
        return null;
    }
    const key = `${name}::${setCode}::${number}`;
    return overrides[key] || null;
}

/**
 * Build Limitless CDN thumbnail URL
 * Format: https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/[SET]/[SET]_[NUMBER]_R_EN_[SIZE].png
 * @param setCode - Set acronym (e.g., "OBF")
 * @param number - Card number (will be padded with leading zeroes)
 * @param useSm - true for SM (small), false for XS (extra-small)
 * @returns Limitless CDN URL or null if invalid input
 */
function buildLimitlessUrl(setCode: string, number: string | number, useSm: boolean): string | null {
    if (!setCode || !number) {
        return null;
    }

    const normalizedSet = String(setCode).toUpperCase().trim();
    const normalizedNumber = String(number).trim();

    if (!normalizedSet || !normalizedNumber) {
        return null;
    }

    // Pad number with leading zeroes to at least 3 digits
    const paddedNumber = normalizedNumber.padStart(3, '0');

    // Use SM for small thumbnails, XS for extra-small
    const size = useSm ? 'SM' : 'XS';

    return `https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/${normalizedSet}/${normalizedSet}_${paddedNumber}_R_EN_${size}.png`;
}

/**
 * Build the ordered list of thumbnail candidate URLs for a given card.
 * Variant-specific thumbnails are prioritized when set/number data is available.
 * @param name
 * @param useSm
 * @param overrides
 * @param variant
 * @returns
 */
export function buildThumbCandidates(name: string, useSm: boolean, overrides?: Overrides, variant: Variant | undefined = undefined): string[] {
    const base = useSm ? '/thumbnails/sm/' : '/thumbnails/xs/';
    const candidates: string[] = [];

    const hasVariant = variant && variant.set && variant.number;
    if (hasVariant) {
        const setCode = normalizeSetCode(variant!.set);
        const number = normalizeCardNumber(variant!.number);
        if (setCode && number) {
            const variantFilename = `${sanitizePrimary(`${name}_${setCode}_${number}`)}.png`;
            appendCandidate(candidates, base, variantFilename);

            const variantOverride = getVariantOverride(overrides, name, setCode, number);
            if (variantOverride) {
                appendCandidate(candidates, base, variantOverride);
            } else if (overrides && overrides[name]) {
                appendCandidate(candidates, base, overrides[name]);
            }

            // Add Limitless CDN fallback URL for both SM and XS thumbnails
            const limitlessUrl = buildLimitlessUrl(setCode, number, useSm);
            if (limitlessUrl && !candidates.includes(limitlessUrl)) {
                candidates.push(limitlessUrl);
            }

            return candidates;
        }
    }

    if (overrides && overrides[name]) {
        appendCandidate(candidates, base, overrides[name]);
    }

    const primary = `${sanitizePrimary(name)}.png`;
    appendCandidate(candidates, base, primary);

    appendCandidate(candidates, base, `${sanitizeStripPossessive(name)}.png`);
    appendCandidate(candidates, base, `${sanitizeNoApostrophes(name)}.png`);

    const ascii = asciiFold(name);
    appendCandidate(candidates, base, `${sanitizePrimary(ascii)}.png`);
    appendCandidate(candidates, base, `${sanitizeStripPossessive(ascii)}.png`);
    appendCandidate(candidates, base, `${sanitizeNoApostrophes(ascii)}.png`);

    for (const rocketVariant of teamRocketVariants(name)) {
        appendCandidate(candidates, base, `${sanitizePrimary(rocketVariant)}.png`);
        appendCandidate(candidates, base, `${sanitizeNoApostrophes(rocketVariant)}.png`);
    }

    return candidates;
}
