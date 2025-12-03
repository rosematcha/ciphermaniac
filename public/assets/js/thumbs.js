import { normalizeCardNumber } from './card/routing.js';
import { normalizeSetCode } from './utils/filterState.js';
function appendCandidate(list, url) {
    if (!url) {
        return;
    }
    if (!list.includes(url)) {
        list.push(url);
    }
}
function getVariantOverride(overrides, name, setCode, number) {
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
function buildLimitlessUrl(setCode, number, useSm) {
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
function resolveOverrideCandidate(raw, useSm) {
    if (!raw) {
        return null;
    }
    const trimmed = String(raw).trim();
    if (!trimmed) {
        return null;
    }
    if (/^(https?:)?\/\//i.test(trimmed) || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
        return trimmed;
    }
    const setNumberMatch = trimmed.match(/^([A-Za-z]{2,})[\/:\s]+(\d+[A-Za-z]?)$/);
    if (setNumberMatch) {
        const [, setCode, number] = setNumberMatch;
        return buildLimitlessUrl(setCode, number, useSm);
    }
    if (trimmed.startsWith('/thumbnails/')) {
        return null;
    }
    if (trimmed.startsWith('/assets/')) {
        return trimmed;
    }
    if (trimmed.startsWith('assets/')) {
        return `/${trimmed}`;
    }
    return null;
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
export function buildThumbCandidates(name, useSm, overrides, variant = undefined) {
    const candidates = [];
    const addOverride = (value) => {
        const resolved = resolveOverrideCandidate(value, useSm);
        appendCandidate(candidates, resolved);
    };
    const hasVariant = variant && variant.set && variant.number;
    if (hasVariant) {
        const setCode = normalizeSetCode(variant.set);
        const number = normalizeCardNumber(variant.number);
        if (setCode && number) {
            const variantOverride = getVariantOverride(overrides, name, setCode, number);
            if (variantOverride) {
                addOverride(variantOverride);
            }
            else if (overrides && overrides[name]) {
                addOverride(overrides[name]);
            }
            // Add Limitless CDN fallback URL for both SM and XS thumbnails
            appendCandidate(candidates, buildLimitlessUrl(setCode, number, useSm));
            return candidates;
        }
    }
    if (overrides && overrides[name]) {
        addOverride(overrides[name]);
    }
    return candidates;
}
