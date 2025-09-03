function sanitizePrimary(name) {
  // Normalize and keep Unicode letters/numbers, apostrophes, dashes, underscores; spaces -> underscores
  const s = String(name).normalize('NFC')
    .replace(/\u2019/g, '\'') // curly to straight apostrophe
    .replace(/[:!.,]/g, '')
    .replace(/\s+/g, '_')
    .replace(/[^\p{L}\p{N}_\-']/gu, '_')
    .replace(/_+/g, '_');
  return s;
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

/**
 *
 * @param name
 * @param useSm
 * @param overrides
 * @param variant
 */
export function buildThumbCandidates(name, useSm, overrides, variant) {
  // useSm: true -> sm folder, false -> xs folder
  const base = useSm ? 'thumbnails/sm/' : 'thumbnails/xs/';
  const out = [];
  if (overrides && overrides[name]) {
    out.push(base + overrides[name]);
  }
  // If variant info is provided (set+number), ONLY use that filename (no fallbacks)
  if (variant && variant.set && variant.number) {
    const primaryVariant = `${sanitizePrimary(`${name}_${String(variant.set)}_${String(variant.number)}`)}.png`;
    out.push(base + primaryVariant);
    // Return early - don't add fallback candidates when we have specific variant info
    return Array.from(new Set(out));
  }

  // Fallback candidates (only when no variant info available)
  const primary = `${sanitizePrimary(name)}.png`;
  out.push(base + primary);
  // Apostrophe handling variants
  out.push(`${base + sanitizeStripPossessive(name)}.png`);
  out.push(`${base + sanitizeNoApostrophes(name)}.png`);
  // ASCII-folded variants (accents -> ASCII)
  const ascii = asciiFold(name);
  out.push(`${base + sanitizePrimary(ascii)}.png`);
  out.push(`${base + sanitizeStripPossessive(ascii)}.png`);
  out.push(`${base + sanitizeNoApostrophes(ascii)}.png`);
  // Team Rocket's special case
  for (const v of teamRocketVariants(name)) {
    out.push(`${base + sanitizePrimary(v)}.png`);
    out.push(`${base + sanitizeNoApostrophes(v)}.png`);
  }
  // Deduplicate while preserving order
  return Array.from(new Set(out));
}

// buildThumbPath removed (unused)
