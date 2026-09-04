/**
 * Archetype identity: the one home for the comparison-key / display-label /
 * stable-slug separation and label-normalization primitives.
 *
 * Two distinct normalizations live here on purpose; do not conflate them:
 *  - {@link archetypeKey}/{@link archetypeSlug}: the identity triple used to
 *    group and address archetypes across the pipeline (lowercased comparison
 *    key; URL slug derived from that key, never from a sanitized display label).
 *  - {@link canonicalizeArchetypeLabel}/{@link normalizeForLookup}: the
 *    classifier's label-matching primitives (looser, apostrophe- and
 *    punctuation-stripping) used only to compare a deck name against rule names.
 *
 * This module is environment-neutral.
 */

import { normalizeArchetypeName } from '../../cardUtils';
import type { ArchetypeIdentity } from '../contracts';
import { isRecord } from '../validate';

// Re-export the identity triple type so callers can import it from the domain
// package. The interface is defined in contracts.ts (the schema authority).
export type { ArchetypeIdentity } from '../contracts';

// ============================================================================
// Identity triple: key / displayName / slug
// ============================================================================

/**
 * Derive an archetype comparison key: NFC-normalized, whitespace-collapsed,
 * underscore-to-space, lowercased. Reuses {@link normalizeArchetypeName} but
 * applies Unicode NFC first so composed vs decomposed accents (é U+00E9 vs
 * e+U+0301) collapse to a single key/slug — this intentionally diverges from
 * legacy `normalizeArchetypeName` only for accent-variant inputs.
 *
 * Empty names become `"unknown"`; this fallback is indistinguishable from a real
 * archetype literally named "Unknown" — a knowing legacy-compat decision.
 * @param displayName - The display label
 * @returns Comparison key
 */
export function archetypeKey(displayName: string | null | undefined): string {
  const nfc = typeof displayName === 'string' ? displayName.normalize('NFC') : displayName;
  return normalizeArchetypeName(nfc);
}

/**
 * Derive a URL-safe slug from an archetype KEY (already lowercased). Non
 * alphanumeric runs become single hyphens; leading/trailing hyphens are
 * trimmed. Empty keys become `"unknown"`.
 * @param key - The archetype key
 * @returns URL-safe slug
 */
export function archetypeSlug(key: string): string {
  const slug = key.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'unknown';
}

/**
 * Build the full archetype identity triple from a display label. The key is
 * derived from the label, the slug from the key, and the display label is
 * preserved verbatim.
 * @param displayName - The display label
 * @returns Archetype identity
 */
export function makeArchetypeIdentity(displayName: string): ArchetypeIdentity {
  const key = archetypeKey(displayName);
  return { key, displayName, slug: archetypeSlug(key) };
}

// ============================================================================
// Classifier label-normalization boundary
// ============================================================================
// Moved verbatim from functions/lib/analysis/archetypeClassifier.ts so the
// classifier's local name normalization has one home. Behavior is unchanged;
// the classifier now imports these.

/**
 * Collapse a raw archetype label to display form: underscores to spaces,
 * whitespace collapsed, trimmed. Preserves case (unlike {@link archetypeKey}).
 * @param value - Raw label
 * @returns Canonicalized display label
 */
export function canonicalizeArchetypeLabel(value: unknown): string {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize a label for loose lookup/matching: canonicalized, lowercased,
 * apostrophes removed, any non-alphanumeric run collapsed to a single space,
 * trimmed. Looser than {@link archetypeKey} — used only for classifier rule
 * matching, never for identity keys.
 * @param value - Raw label
 * @returns Lookup-normalized string
 */
export function normalizeForLookup(value: unknown): string {
  return canonicalizeArchetypeLabel(value)
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate an archetype identity triple: all three fields are strings, the key
 * derives from the display name, and the slug derives from the key.
 *
 * The derivation is the whole point of the triple — a stored key or slug that
 * disagrees with its display name means two producers disagree about which
 * archetype a deck belongs to, which silently splits an archetype in two. Both
 * the normalized contract (`deck.archetype`) and the serving artifact
 * (`ArchetypeIndexEntry.identity`) carry this triple, so the check lives here
 * with the derivation rather than being written out once per layer.
 * @param identity the untrusted candidate triple
 * @param path dotted path for error messages
 * @param errors accumulator appended to in place
 */
export function validateArchetypeIdentity(identity: unknown, path: string, errors: string[]): void {
  if (!isRecord(identity)) {
    errors.push(`${path}: expected object`);
    return;
  }
  const { key, displayName, slug } = identity;
  if (typeof key !== 'string' || typeof displayName !== 'string' || typeof slug !== 'string') {
    errors.push(`${path}: key, displayName, and slug must all be strings`);
    return;
  }
  const expectedKey = archetypeKey(displayName);
  if (key !== expectedKey) {
    errors.push(`${path}.key: "${key}" does not match derived key "${expectedKey}"`);
  }
  const expectedSlug = archetypeSlug(key);
  if (slug !== expectedSlug) {
    errors.push(`${path}.slug: "${slug}" does not match derived slug "${expectedSlug}"`);
  }
}
