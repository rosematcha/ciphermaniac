/**
 * Archetype presentation: the ONE implementation of archetype thumbnails,
 * signature cards, and icons (DB-MASTER-PLAN Phase 2, slice 5; decision D8).
 *
 * Merged authorities, per the plan's "Archetype presentation" row:
 * - Thumbnails + signature cards: ported verbatim from the CURRENT ONLINE
 *   pipeline (`.github/scripts/run-online-meta.mjs`), which is authoritative.
 *   The older copy in `functions/lib/onlineMeta/reportGenerator.ts` (stage-1
 *   inference only, 99.9% gate) was stale and retires with this module.
 * - Icons: ported from `.github/scripts/download-tournament.py`
 *   (`resolve_archetype_icons` and helpers) — Python was the only icon
 *   implementation, so this is the one place the plan authorizes porting FROM
 *   Python into TypeScript.
 *
 * Every fallback class is annotated with its source below. Config maps
 * (thumbnail/icon overrides) are passed in by callers — this module performs
 * no I/O and imports no JSON, so it stays isomorphic and testable.
 *
 * Quote-handling fidelity notes (intentional, byte-parity-preserving):
 * - The online JS strips only the STRAIGHT apostrophe (its `['']` character
 *   classes contain U+0027 twice), while Python also strips curly quotes.
 *   Thumbnail/signature paths reproduce the online behavior; the icon path
 *   reproduces Python's.
 *
 * IMPORTANT: isomorphic — no environment-specific dependencies.
 * @module shared/data/archetypes/presentation
 */

// ============================================================================
// Types
// ============================================================================

/** A report item as consumed by the presentation engine (loosely typed — the
 * legacy report shape carries more fields than presentation reads). */
export interface PresentationItem {
  name?: string;
  set?: string | null;
  number?: string | number | null;
  pct?: number | string;
  category?: string | null;
  energyType?: string | null;
}

/** The subset of a legacy card report that presentation reads. */
export interface PresentationReport {
  items?: PresentationItem[];
}

/** Archetype label → explicit thumbnail ids (`SET/NNN`), hand-maintained. */
export type ThumbnailConfig = Record<string, string[]>;

/** Archetype label → explicit Limitless icon slugs, hand-maintained. */
export type IconConfig = Record<string, string[]>;

/** Thumbnail id (`SET/NNN`) → ability/attack names from the card-types DB. */
export type CardMetaLookup = Map<string, { abilities: string[]; attacks: string[] }>;

/** A signature card row as emitted in archetype index entries. */
export interface SignatureCard {
  name: string;
  set: string | null;
  number: string | number | null;
  pct: number;
}

/** Inference inputs for thumbnail resolution beyond the report itself. */
export interface ThumbnailContext {
  /** Hand-maintained override map (archetype-thumbnails.json). */
  config?: ThumbnailConfig | null;
  /** Stage 2 input: ability/attack names per thumbnail id. */
  cardMetaLookup?: CardMetaLookup | null;
  /** Stage 3 input: card name → meta-wide usage pct from the master report. */
  metaUsage?: Map<string, number> | null;
}

// ============================================================================
// Constants — source: run-online-meta.mjs (identical in Python)
// ============================================================================

export const AUTO_THUMB_MAX = 2;
// Stage 1 (name-based) gate. The title Pokemon often sits just under 100% (e.g.
// Dragapult ex at ~99.3%), so a near-100 gate produced empty thumbnails and the
// trainer-laden signatureCards fallback. The coverage algorithm + early-break
// already keep low-pct noise out, so a low floor is safe.
export const AUTO_THUMB_REQUIRED_PCT = 30;
// Floor for Stage 2 (ability/attack) and Stage 3 (distinctiveness) candidates so
// tech/splash cards don't surface as the archetype face.
export const AUTO_THUMB_STRATEGY_MIN_PCT = 20;
export const SIGNATURE_CARDS_COUNT = 5;
export const SIGNATURE_MIN_ARCHETYPE_PCT = 20; // Minimum usage in archetype to consider

const ARCHETYPE_DESCRIPTOR_TOKENS = new Set(['box', 'control', 'festival', 'lead', 'toolbox', 'turbo']);

// ============================================================================
// Shared text primitives — source: run-online-meta.mjs
// ============================================================================

function tokenizeForMatching(text: unknown): string[] {
  const normalized = String(text || '')
    // Straight apostrophe only — the online source's char class contains U+0027
    // twice. (Python also handles curly quotes; not reproduced here because the
    // thumbnail/signature authority is the online implementation.)
    .replace(/['']s\b/gi, 's')
    .replace(/_/g, ' ')
    .toLowerCase();

  return normalized
    .split(/[^a-z0-9]+/gi)
    .map(token => token.trim())
    .filter(Boolean);
}

function extractArchetypeKeywords(name: unknown): string[] {
  return tokenizeForMatching(name).filter(token => !ARCHETYPE_DESCRIPTOR_TOKENS.has(token));
}

function formatCardNumber(raw: string | number | null | undefined): string | null {
  if (raw === undefined || raw === null) {
    return null;
  }
  const str = String(raw).trim();
  if (!str) {
    return null;
  }
  const match = str.match(/^(\d+)([A-Za-z]*)$/);
  if (!match) {
    return str.toUpperCase();
  }
  const [, digits, suffix = ''] = match;
  return `${digits.padStart(3, '0')}${suffix.toUpperCase()}`;
}

/**
 * Build a normalized thumbnail id (`SET/NNN`) from a set code and number, or
 * null when either half is missing. Source: run-online-meta.mjs.
 * @param setCode - Set code (any casing)
 * @param number - Card number (padded on demand)
 * @returns Thumbnail id or null
 */
export function buildThumbnailId(
  setCode: string | null | undefined,
  number: string | number | null | undefined
): string | null {
  const formattedNumber = formatCardNumber(number);
  const set = String(setCode || '')
    .toUpperCase()
    .trim();
  if (!formattedNumber || !set) {
    return null;
  }
  return `${set}/${formattedNumber}`;
}

/**
 * Normalize a deck label for override-config reconciliation, ONLINE flavor:
 * strips the straight apostrophe only. Source: run-online-meta.mjs
 * `normalizeDeckLabel` (also present in the retired reportGenerator copy).
 */
function normalizeDeckLabel(label: unknown): string {
  return String(label || '')
    .replace(/[']/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

/**
 * Normalize a deck label for override-config reconciliation, PYTHON flavor:
 * strips curly quotes as well. Source: download-tournament.py
 * `normalize_deck_label`; used only by the icon resolver, whose authority is
 * the Python implementation.
 */
function normalizeDeckLabelIcons(label: unknown): string {
  return String(label || '')
    .replace(/[‘’']/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function normalizePhrase(text: unknown): string {
  return tokenizeForMatching(text).join(' ');
}

/**
 * Normalize a Pokémon name for matching by removing suffixes like "ex", "V",
 * "VSTAR", etc. Source: run-online-meta.mjs `normalizeForPokemonMatch`. (Its
 * quote-replace step is a no-op there — straight quote to straight quote — and
 * is omitted here.)
 */
function normalizeForPokemonMatch(name: unknown): string {
  return String(name || '')
    .toLowerCase()
    .replace(/\s+(ex|v|vmax|vstar|gx|break|radiant|prism star)$/i, '')
    .trim();
}

/**
 * Check if a card name matches any archetype keyword. Handles "ex" suffix
 * matching (e.g., "Dragapult ex" matches "Dragapult").
 * Source: run-online-meta.mjs.
 */
function cardMatchesArchetypeKeyword(cardName: unknown, archetypeKeywords: Set<string>): boolean {
  const normalizedName = normalizeForPokemonMatch(cardName);
  const cardTokens = tokenizeForMatching(normalizedName);
  for (const token of cardTokens) {
    if (archetypeKeywords.has(token)) {
      return true;
    }
  }
  return false;
}

/**
 * Coarse species identity (last name token after stripping ex/V suffixes) so
 * Stage 3 doesn't pick two cards of the same Pokemon. Source: run-online-meta.mjs
 * (identical to Python `_species_key`).
 */
function speciesKey(cardName: unknown): string {
  const tokens = tokenizeForMatching(normalizeForPokemonMatch(cardName));
  return tokens.length ? tokens[tokens.length - 1] : '';
}

/** Strip leading zeros in the number half of a `SET/NNN` id so differently
 * padded ids compare equal. Source: run-online-meta.mjs `cardInThumbnails`
 * normalization / Python `_strip_leading_zeros_in_id`. */
function stripLeadingZerosInId(thumbId: string): string {
  return thumbId.toUpperCase().replace(/\/0*(\d)/, '/$1');
}

// ============================================================================
// Category predicates — source: run-online-meta.mjs
// ============================================================================

function isBasicEnergy(card: PresentationItem): boolean {
  const category = String(card.category || '').toLowerCase();
  const energyType = String(card.energyType || '').toLowerCase();

  if (category.includes('energy/basic') || category === 'energy/basic') {
    return true;
  }
  if (energyType === 'basic') {
    return true;
  }
  const name = String(card.name || '').toLowerCase();
  const basicEnergyNames = [
    'grass energy',
    'fire energy',
    'water energy',
    'lightning energy',
    'psychic energy',
    'fighting energy',
    'darkness energy',
    'metal energy',
    'fairy energy',
    'dragon energy'
  ];
  return basicEnergyNames.some(e => name === e);
}

function isPokemon(card: PresentationItem): boolean {
  const category = String(card.category || '').toLowerCase();
  return category === 'pokemon' || category.startsWith('pokemon/');
}

function isTrainer(card: PresentationItem): boolean {
  const category = String(card.category || '').toLowerCase();
  return category === 'trainer' || category.startsWith('trainer/');
}

function isSpecialEnergy(card: PresentationItem): boolean {
  const category = String(card.category || '').toLowerCase();
  const energyType = String(card.energyType || '').toLowerCase();

  if (category.includes('energy/special')) {
    return true;
  }
  if (energyType === 'special') {
    return true;
  }
  if ((category === 'energy' || category.startsWith('energy')) && !isBasicEnergy(card)) {
    return true;
  }
  return false;
}

// ============================================================================
// Card-types DB / master-report lookups
// ============================================================================

/**
 * Map normalized thumbnail id (`SET/NNN`) → {abilities, attacks} from the
 * card-types DB so the thumbnail engine can match an archetype title against a
 * card's ability/attack names (Stage 2). Source: run-online-meta.mjs.
 * @param cardTypesDb - Card-types DB keyed `SET::NUMBER`
 * @returns Lookup map
 */
export function buildCardMetaLookup(cardTypesDb: unknown): CardMetaLookup {
  const lookup: CardMetaLookup = new Map();
  for (const [key, info] of Object.entries((cardTypesDb as Record<string, unknown>) || {})) {
    if (!info || typeof info !== 'object') {
      continue;
    }
    const record = info as { abilities?: string[]; attacks?: string[] };
    const abilities = record.abilities || [];
    const attacks = record.attacks || [];
    if (!abilities.length && !attacks.length) {
      continue;
    }
    const [setCode, number] = String(key).split('::');
    const thumbId = buildThumbnailId(setCode, number);
    if (!thumbId) {
      continue;
    }
    lookup.set(thumbId, { abilities: [...abilities], attacks: [...attacks] });
  }
  return lookup;
}

/**
 * Card name → meta-wide usage pct from the master report, used by Stage 3
 * distinctiveness and signature-card scoring. Source: run-online-meta.mjs
 * (inlined there in buildArchetypeReports and generateSignatureCards).
 * @param masterReport - The overall meta report
 * @returns Usage map
 */
export function buildMetaUsage(masterReport: PresentationReport | null | undefined): Map<string, number> {
  const metaUsage = new Map<string, number>();
  for (const item of masterReport?.items || []) {
    if (item?.name) {
      metaUsage.set(item.name, Number(item.pct) || 0);
    }
  }
  return metaUsage;
}

// ============================================================================
// Thumbnails — authority: run-online-meta.mjs (online pipeline)
// ============================================================================

/** Stage 1: name-based coverage match (the common case). Source: run-online-meta.mjs. */
function inferNameThumbnails(items: PresentationItem[], keywordSet: Set<string>): string[] {
  const candidates: Array<{ id: string; matchCount: number; pct: number; index: number; tokens: string[] }> = [];
  items.forEach((item, index) => {
    const pct = Number(item?.pct);
    if (!Number.isFinite(pct) || pct < AUTO_THUMB_REQUIRED_PCT) {
      return;
    }
    const category = String(item?.category || '').toLowerCase();
    if (category && !category.includes('pokemon')) {
      return;
    }
    const thumbnailId = buildThumbnailId(item?.set, item?.number);
    if (!thumbnailId) {
      return;
    }
    const cardTokens = extractArchetypeKeywords(item?.name || '');
    const matchCount = cardTokens.filter(token => keywordSet.has(token)).length;
    if (matchCount === 0) {
      return;
    }
    candidates.push({ id: thumbnailId, matchCount, pct, index, tokens: cardTokens });
  });

  if (!candidates.length) {
    return [];
  }

  candidates.sort((a, b) => b.matchCount - a.matchCount || b.pct - a.pct || a.index - b.index);

  const selected: string[] = [];
  const covered = new Set<string>();
  for (const candidate of candidates) {
    const coversNewToken = candidate.tokens.some(token => keywordSet.has(token) && !covered.has(token));
    if (!coversNewToken && selected.length > 0) {
      continue;
    }
    if (selected.includes(candidate.id)) {
      continue;
    }
    selected.push(candidate.id);
    candidate.tokens.forEach(token => {
      if (keywordSet.has(token)) {
        covered.add(token);
      }
    });
    if (selected.length >= AUTO_THUMB_MAX || covered.size >= keywordSet.size) {
      break;
    }
  }

  return selected;
}

/**
 * Stage 2: strategy decks named after a shared ability/attack (e.g. "Festival
 * Lead" → Dipplin's ability, historically "Night March" → an attack). Match the
 * raw title against each Pokemon's ability/attack names, ranked by usage.
 * Source: run-online-meta.mjs.
 */
function inferAbilityThumbnails(
  items: PresentationItem[],
  rawTitle: string,
  cardMetaLookup: CardMetaLookup | null | undefined
): string[] {
  const titlePhrase = normalizePhrase(rawTitle);
  if (!titlePhrase || !cardMetaLookup || cardMetaLookup.size === 0) {
    return [];
  }
  const titleTokens = new Set(titlePhrase.split(' '));

  const phraseMatches: Array<{ pct: number; index: number; id: string }> = [];
  const tokenMatches: Array<{ pct: number; index: number; id: string }> = [];
  items.forEach((item, index) => {
    const category = String(item?.category || '').toLowerCase();
    if (category && !category.includes('pokemon')) {
      return;
    }
    const pct = Number(item?.pct);
    if (!Number.isFinite(pct) || pct < AUTO_THUMB_STRATEGY_MIN_PCT) {
      return;
    }
    const thumbnailId = buildThumbnailId(item?.set, item?.number);
    if (!thumbnailId) {
      return;
    }
    const meta = cardMetaLookup.get(thumbnailId);
    if (!meta) {
      return;
    }
    const names = [...(meta.abilities || []), ...(meta.attacks || [])].map(normalizePhrase).filter(Boolean);
    if (names.some(name => name.includes(titlePhrase))) {
      phraseMatches.push({ pct, index, id: thumbnailId });
    } else if (names.some(name => [...titleTokens].every(t => name.split(' ').includes(t)))) {
      tokenMatches.push({ pct, index, id: thumbnailId });
    }
  });

  const ordered = [
    ...phraseMatches.sort((a, b) => b.pct - a.pct || a.index - b.index),
    ...tokenMatches.sort((a, b) => b.pct - a.pct || a.index - b.index)
  ];
  const selected: string[] = [];
  for (const { id } of ordered) {
    if (!selected.includes(id)) {
      selected.push(id);
    }
    if (selected.length >= AUTO_THUMB_MAX) {
      break;
    }
  }
  return selected;
}

/**
 * Stage 3 last resort: rank Pokemon by distinctiveness (archetype_pct −
 * meta_pct), never Trainers/Energy, so every deck gets a sensible image.
 * Source: run-online-meta.mjs.
 */
function inferDistinctiveThumbnails(
  items: PresentationItem[],
  metaUsage: Map<string, number> | null | undefined
): string[] {
  const candidates: Array<{ distinct: number; pct: number; index: number; id: string; species: string }> = [];
  items.forEach((item, index) => {
    if (!isPokemon(item)) {
      return;
    }
    const pct = Number(item?.pct);
    if (!Number.isFinite(pct) || pct < AUTO_THUMB_STRATEGY_MIN_PCT) {
      return;
    }
    const thumbnailId = buildThumbnailId(item?.set, item?.number);
    if (!thumbnailId) {
      return;
    }
    const metaPct = (metaUsage && item?.name !== undefined && metaUsage.get(String(item.name))) || 0;
    candidates.push({ distinct: pct - metaPct, pct, index, id: thumbnailId, species: speciesKey(item?.name) });
  });

  candidates.sort((a, b) => b.distinct - a.distinct || b.pct - a.pct || a.index - b.index);
  const selected: string[] = [];
  const seenSpecies = new Set<string>();
  for (const { id, species } of candidates) {
    // Avoid two cards of the same Pokemon (e.g. Teal Mask + Wellspring Mask
    // Ogerpon ex) eating both slots — prefer variety.
    if (species && seenSpecies.has(species)) {
      continue;
    }
    if (!selected.includes(id)) {
      selected.push(id);
      if (species) {
        seenSpecies.add(species);
      }
    }
    if (selected.length >= AUTO_THUMB_MAX) {
      break;
    }
  }
  return selected;
}

/** Three-stage inference when no override matches. Source: run-online-meta.mjs. */
function inferArchetypeThumbnails(
  displayName: string,
  reportData: PresentationReport | null | undefined,
  cardMetaLookup: CardMetaLookup | null | undefined,
  metaUsage: Map<string, number> | null | undefined
): string[] {
  const items = reportData && Array.isArray(reportData.items) ? reportData.items : null;
  if (!items || items.length === 0) {
    return [];
  }

  // Stage 1: name-based coverage match (the common case).
  const keywordSet = new Set(extractArchetypeKeywords(displayName));
  if (keywordSet.size > 0) {
    const nameThumbs = inferNameThumbnails(items, keywordSet);
    if (nameThumbs.length) {
      return nameThumbs;
    }
  }

  // Stage 2: strategy decks named after a shared ability/attack.
  const abilityThumbs = inferAbilityThumbnails(items, displayName, cardMetaLookup);
  if (abilityThumbs.length) {
    return abilityThumbs;
  }

  // Stage 3: distinctiveness-ranked Pokemon-only last resort.
  return inferDistinctiveThumbnails(items, metaUsage);
}

/**
 * Resolve an archetype's thumbnails. Fallback order (source: run-online-meta.mjs):
 * 1. Override config hit on the display name, its underscore→space form, or the
 *    filename base.
 * 2. Override config hit after label normalization (case/punctuation-insensitive
 *    reconciliation between producer labels and hand-maintained keys).
 * 3. Three-stage inference from the archetype's own report (name coverage →
 *    ability/attack title match → distinctiveness ranking).
 * @param baseName - Filename base (slug) of the archetype
 * @param displayName - Cased display label
 * @param reportData - The archetype's card report
 * @param context - Override config plus stage 2/3 inputs
 * @returns Thumbnail ids (`SET/NNN`), at most {@link AUTO_THUMB_MAX} when inferred
 */
export function resolveArchetypeThumbnails(
  baseName: string,
  displayName: string,
  reportData: PresentationReport | null | undefined,
  context: ThumbnailContext = {}
): string[] {
  const config = context.config || {};

  // Fallback class 1 — direct override hit (online behavior; note: an explicit
  // config entry is returned whole, NOT capped at AUTO_THUMB_MAX).
  const attempts = [displayName, displayName?.replace(/_/g, ' '), baseName];
  for (const key of attempts) {
    if (key && Array.isArray(config[key]) && config[key].length) {
      return config[key];
    }
  }

  // Fallback class 2 — normalized-label override reconciliation (online behavior).
  const target = normalizeDeckLabel(displayName || baseName || '');
  if (target) {
    for (const [candidate, ids] of Object.entries(config)) {
      if (normalizeDeckLabel(candidate) === target && Array.isArray(ids) && ids.length) {
        return ids;
      }
    }
  }

  // Fallback class 3 — inference from report data (online behavior).
  return inferArchetypeThumbnails(displayName || baseName || '', reportData, context.cardMetaLookup, context.metaUsage);
}

// ============================================================================
// Signature cards — authority: run-online-meta.mjs (online pipeline)
// ============================================================================

/**
 * Generate signature cards for an archetype. These are cards that best
 * exemplify the archetype (source: run-online-meta.mjs):
 * - Pokémon in the archetype name or thumbnails (highest priority).
 * - Trainers/Special Energy with high archetype usage vs low meta usage
 *   (distinctiveness > 5).
 * Basic Energy is never shown; non-defining Pokémon are skipped entirely.
 * @param displayName - Archetype display name
 * @param archetypeReport - Report with items array
 * @param masterReport - Overall meta report with items array
 * @param thumbnails - Thumbnail card IDs
 * @returns At most {@link SIGNATURE_CARDS_COUNT} signature cards
 */
export function generateSignatureCards(
  displayName: string,
  archetypeReport: PresentationReport | null | undefined,
  masterReport: PresentationReport | null | undefined,
  thumbnails: string[]
): SignatureCard[] {
  const items = archetypeReport?.items || [];
  if (items.length === 0) {
    return [];
  }

  const archetypeKeywords = new Set(extractArchetypeKeywords(displayName));
  const metaUsage = buildMetaUsage(masterReport);

  const candidates: Array<SignatureCard & { score: number; isDefining: boolean }> = [];

  for (const card of items) {
    const archetypePct = Number(card.pct) || 0;

    // Skip cards with very low archetype usage.
    if (archetypePct < SIGNATURE_MIN_ARCHETYPE_PCT) {
      continue;
    }

    // Never show Basic Energy.
    if (isBasicEnergy(card)) {
      continue;
    }

    const metaPct = (card.name !== undefined && metaUsage.get(String(card.name))) || 0;

    if (isPokemon(card)) {
      // Only include Pokémon if they're in the archetype name or thumbnails.
      const matchesName = cardMatchesArchetypeKeyword(card.name, archetypeKeywords);
      const inThumbs = cardInThumbnails(card, thumbnails);

      if (matchesName || inThumbs) {
        // Pokémon in name/thumbnails get highest priority (score = 1000 + pct).
        candidates.push({
          name: String(card.name),
          set: card.set || null,
          number: card.number || null,
          pct: archetypePct,
          score: 1000 + archetypePct,
          isDefining: true
        });
      }
      // Non-defining Pokémon are skipped entirely.
    } else if (isTrainer(card) || isSpecialEnergy(card)) {
      // Score by distinctiveness: how much more this deck uses it vs the meta.
      const distinctiveness = archetypePct - metaPct;
      if (distinctiveness > 5) {
        candidates.push({
          name: String(card.name),
          set: card.set || null,
          number: card.number || null,
          pct: archetypePct,
          score: distinctiveness,
          isDefining: false
        });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  return candidates.slice(0, SIGNATURE_CARDS_COUNT).map(c => ({
    name: c.name,
    set: c.set,
    number: c.number,
    pct: c.pct
  }));
}

/**
 * Check if a card is in the thumbnail set for this archetype (padding
 * insensitive). Source: run-online-meta.mjs.
 */
function cardInThumbnails(card: PresentationItem, thumbnails: string[]): boolean {
  if (!thumbnails || !Array.isArray(thumbnails) || thumbnails.length === 0) {
    return false;
  }
  const cardThumbId = buildThumbnailId(card.set, card.number);
  if (!cardThumbId) {
    return false;
  }
  const normalizedCard = stripLeadingZerosInId(cardThumbId);
  return thumbnails.some(thumb => stripLeadingZerosInId(thumb) === normalizedCard);
}

// ============================================================================
// Icons — authority: download-tournament.py (the only icon implementation;
// ported to TypeScript per the plan's one authorized Python port)
// ============================================================================

/**
 * Pokémon card name → Limitless icon slug (lowercase, hyphenated, ex/V/…
 * suffix stripped). e.g. "Raging Bolt ex" → "raging-bolt", "Dragapult ex" →
 * "dragapult". Form variants (greninja-mega, lucario-mega) can't be recovered
 * from the card name — those live in the override config (archetype-icons.json).
 * Source: download-tournament.py `slugify_pokemon_icon` (quote handling covers
 * straight AND curly quotes, composing Python's two-step strip).
 * @param name - Pokémon card name
 * @returns Icon slug
 */
export function slugifyPokemonIcon(name: unknown): string {
  return normalizeForPokemonMatch(name)
    .replace(/[‘’']/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Map the archetype's representative thumbnail cards back to their Pokémon
 * names and slugify them. The thumbnail engine already picked the deck's face
 * Pokémon (Stage 1-3), so this reuses that work rather than re-tokenizing the
 * archetype name (which can't tell "Raging Bolt" is one Pokémon, not two).
 * Source: download-tournament.py `_derive_icons_from_thumbnails`.
 */
function deriveIconsFromThumbnails(thumbnails: string[], reportData: PresentationReport | null | undefined): string[] {
  if (!thumbnails.length) {
    return [];
  }
  const nameById = new Map<string, string>();
  for (const item of reportData?.items || []) {
    if (!isPokemon(item)) {
      continue;
    }
    const thumbId = buildThumbnailId(item.set, item.number);
    if (thumbId) {
      nameById.set(stripLeadingZerosInId(thumbId), String(item.name || ''));
    }
  }

  const slugs: string[] = [];
  const seenSpecies = new Set<string>();
  for (const thumb of thumbnails) {
    const name = nameById.get(stripLeadingZerosInId(thumb));
    if (!name) {
      continue;
    }
    const slug = slugifyPokemonIcon(name);
    const species = speciesKey(name);
    if (!slug || (species && seenSpecies.has(species)) || slugs.includes(slug)) {
      continue;
    }
    slugs.push(slug);
    if (species) {
      seenSpecies.add(species);
    }
    if (slugs.length >= AUTO_THUMB_MAX) {
      break;
    }
  }
  return slugs;
}

/**
 * Resolve an archetype's icon slugs. Fallback order (source:
 * download-tournament.py `resolve_archetype_icons`):
 * 1. Override config hit on the display name, its underscore→space form, or the
 *    filename base — capped at {@link AUTO_THUMB_MAX} (unlike thumbnails, whose
 *    explicit overrides are returned whole).
 * 2. Override config hit after Python-flavor label normalization (also strips
 *    curly quotes) so Labs deck names match Limitless decks-page labels.
 * 3. Slugs derived from the chosen thumbnail Pokémon.
 * @param baseName - Filename base (slug) of the archetype
 * @param displayName - Cased display label
 * @param thumbnails - Already-resolved thumbnail ids for this archetype
 * @param reportData - The archetype's card report
 * @param config - Hand-maintained override map (archetype-icons.json)
 * @returns Icon slugs, at most {@link AUTO_THUMB_MAX}
 */
export function resolveArchetypeIcons(
  baseName: string,
  displayName: string,
  thumbnails: string[],
  reportData: PresentationReport | null | undefined,
  config: IconConfig | null | undefined
): string[] {
  const overrides = config || {};

  // Fallback class 1 — direct override hit (Python behavior; capped).
  const attempts = [displayName, displayName ? displayName.replace(/_/g, ' ') : displayName, baseName];
  for (const key of attempts) {
    if (key && Array.isArray(overrides[key]) && overrides[key].length) {
      return overrides[key].slice(0, AUTO_THUMB_MAX);
    }
  }

  // Fallback class 2 — normalized-label override reconciliation (Python behavior).
  const target = normalizeDeckLabelIcons(displayName || baseName || '');
  if (target) {
    for (const [key, slugs] of Object.entries(overrides)) {
      if (normalizeDeckLabelIcons(key) === target && Array.isArray(slugs) && slugs.length) {
        return slugs.slice(0, AUTO_THUMB_MAX);
      }
    }
  }

  // Fallback class 3 — derive from the chosen thumbnails (Python behavior).
  return deriveIconsFromThumbnails(thumbnails, reportData);
}
