import { normalizeCardNumber } from './card/routing.js';
import { normalizeSetCode } from './utils/filterState.js';

function sanitizePrimary(name) {
  // Normalize and keep Unicode letters/numbers, apostrophes, dashes, underscores; spaces -> underscores
  const sanitized = String(name).normalize('NFC')
    .replace(/\u2019/g, '\'') // curly to straight apostrophe
    .replace(/[:!,]/g, '')
    .replace(/\s+/g, '_')
    .replace(/[^\p{L}\p{N}_\-'.]/gu, '_')
    .replace(/_+/g, '_');
  return sanitized;
}

function sanitizeNoApostrophes(name) {
  return sanitizePrimary(name).replace(/'/g, '');
}

function sanitizeStripPossessive(name) {
  // Turn "X's_Y" into "Xs_Y" (remove apostrophe before s)
  return sanitizePrimary(name).replace(/'s_/gi, 's_').replace(/'s\./gi, 's.').replace(/'/g, '');
}

function asciiFold(name) {
  // Remove diacritics
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC');
}

function teamRocketVariants(name) {
  const variants = [];
  if (/Team Rocket's/i.test(name)) {
    variants.push(name.replace(/Team Rocket's/gi, 'Team Rocket\'s')); // normalized
    variants.push(name.replace(/Team Rocket's/gi, 'Team Rockets'));
  }
  return variants;
}

function appendCandidate(list, base, relative) {
  if (!relative) {return;}
  const trimmed = relative.startsWith('/') ? relative.slice(1) : relative;
  const fullPath = `${base}${trimmed}`;
  if (!list.includes(fullPath)) {
    list.push(fullPath);
  }
}

function getVariantOverride(overrides, name, setCode, number) {
  if (!overrides) {return null;}
  const key = `${name}::${setCode}::${number}`;
  return overrides[key] || null;
}

/**
 * Build the ordered list of thumbnail candidate URLs for a given card.
 * Variant-specific thumbnails are prioritized when set/number data is available.
 * @param {string} name
 * @param {boolean} useSm
 * @param {Record<string, string>|undefined} overrides
 * @param {{set?: string, number?: string|number}|undefined} variant
 * @returns {string[]}
 */
export function buildThumbCandidates(name, useSm, overrides, variant) {
  const base = useSm ? '/thumbnails/sm/' : '/thumbnails/xs/';
  const candidates = [];

  const hasVariant = variant && variant.set && variant.number;
  if (hasVariant) {
    const setCode = normalizeSetCode(variant.set);
    const number = normalizeCardNumber(variant.number);
    if (setCode && number) {
      const variantFilename = `${sanitizePrimary(`${name}_${setCode}_${number}`)}.png`;
      appendCandidate(candidates, base, variantFilename);

      const variantOverride = getVariantOverride(overrides, name, setCode, number);
      if (variantOverride) {
        appendCandidate(candidates, base, variantOverride);
      } else if (overrides && overrides[name]) {
        appendCandidate(candidates, base, overrides[name]);
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

// buildThumbPath removed (unused)
