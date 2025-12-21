import { normalizeCardNumber } from './card/routing.js';
import { normalizeSetCode } from './utils/filterState.js';

interface Variant {
  set?: string;
  number?: string | number;
}

interface Overrides {
  [key: string]: string;
}

function appendCandidate(list: string[], url: string | null | undefined): void {
  if (!url) {
    return;
  }
  if (!list.includes(url)) {
    list.push(url);
  }
}

function getVariantOverride(
  overrides: Overrides | undefined,
  name: string,
  setCode: string,
  number: string
): string | null {
  if (!overrides) {
    return null;
  }
  const key = `${name}::${setCode}::${number}`;
  return overrides[key] || null;
}

// Memoization cache for thumbnail URLs
const urlCache = new Map<string, string | null>();

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

  const cacheKey = `${setCode}|${number}|${useSm}`;
  const cached = urlCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const normalizedSet = String(setCode).toUpperCase().trim();
  const normalizedNumber = String(number).trim();

  if (!normalizedSet || !normalizedNumber) {
    urlCache.set(cacheKey, null);
    return null;
  }

  // Pad number with leading zeroes to at least 3 digits
  const paddedNumber = normalizedNumber.padStart(3, '0');

  // Use SM for small thumbnails, XS for extra-small
  const size = useSm ? 'SM' : 'XS';

  const url = `https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/${normalizedSet}/${normalizedSet}_${paddedNumber}_R_EN_${size}.png`;
  urlCache.set(cacheKey, url);
  return url;
}

/**
 * Clear the thumbnail URL cache for memory management
 */
export function clearThumbnailCache(): void {
  urlCache.clear();
}

function resolveOverrideCandidate(raw: string | null | undefined, useSm: boolean): string | null {
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

  const setNumberMatch = trimmed.match(/^([A-Za-z]{2,})[/:\s]+(\d+[A-Za-z]?)$/);
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
export function buildThumbCandidates(
  name: string,
  useSm: boolean,
  overrides?: Overrides,
  variant: Variant | undefined = undefined
): string[] {
  const candidates: string[] = [];
  const addOverride = (value: string | null | undefined) => {
    const resolved = resolveOverrideCandidate(value, useSm);
    appendCandidate(candidates, resolved);
  };

  const hasVariant = variant && variant.set && variant.number;
  if (hasVariant) {
    const setCode = normalizeSetCode(variant!.set);
    const number = normalizeCardNumber(variant!.number);
    if (setCode && number) {
      const variantOverride = getVariantOverride(overrides, name, setCode, number);
      if (variantOverride) {
        addOverride(variantOverride);
      } else if (overrides && overrides[name]) {
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
