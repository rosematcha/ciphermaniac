/**
 * Normalized-layer data contract (schema v1).
 *
 * One schema represents both data sources: Limitless Labs events
 * (`kind: 'labs-event'`) and the rolling online window (`kind: 'online-window'`).
 * These are the canonical normalized records — stable IDs, schema versions,
 * counts (never percentages), archetype identity split into key/displayName/slug.
 * Denormalized serving artifacts (percentages, distributions, sort order) are a
 * separate layer built from these records.
 *
 * Contract decisions this file freezes (see .scratch/db-migration design docs):
 * - Percentages use a `Pct` suffix and are 0-100; the normalized layer stores
 *   COUNTS wherever possible and leaves percentages to serving artifacts.
 * - Card numbers are the canonical padded form (018A) via
 *   {@link normalizeCardNumber}; a card UID is `Name::SET::NUMBER` whose set and
 *   number MUST agree with the record's own set/number fields.
 * - Canonical card identity ({@link CardIdentity}) is stored separately from the
 *   source printing ({@link CardPrinting}); a synonym rewrite can leave the
 *   canonical set/number differing from the printing's.
 * - Archetype identity is a triple {key, displayName, slug}: key is the
 *   lowercased whitespace-collapsed display name, slug is URL-safe and derived
 *   from the KEY (never from a sanitized display label).
 *
 * IMPORTANT: this module is environment-neutral (browser + Node + Workers). It
 * must not import `node:crypto`; the {@link deckId} constructor takes a hash
 * function so callers can supply `sha256Hex` from `shared/data/hash.ts`.
 * @module shared/data/contracts
 */

import { canonicalizeVariant, normalizeArchetypeName, normalizeCardNumber } from '../cardUtils';

/** Schema version stamped on every top-level normalized record. */
export const SCHEMA_VERSION = 1;

// ============================================================================
// Enums / literal unions
// ============================================================================

/** Data source shape for a normalized event. */
export type NormalizedEventKind = 'labs-event' | 'online-window';

/** Top-level card category. */
export type CardCategory = 'pokemon' | 'trainer' | 'energy';

/** Trainer subtype (present only when category is `trainer`). */
export type TrainerType = 'supporter' | 'item' | 'stadium' | 'tool';

/** Energy subtype (present only when category is `energy`). */
export type EnergyType = 'basic' | 'special';

/**
 * Perspective-free canonical match outcome. `decided` marks a match with a
 * single winner (named by {@link Match.winnerParticipantId}); win/loss are
 * retained for per-side derivations but a canonical Match record never uses
 * them. `bye`/`unpaired` are solo (single-participant) rows.
 */
export type MatchOutcome = 'decided' | 'win' | 'loss' | 'tie' | 'double_loss' | 'bye' | 'unpaired' | 'unknown';

/** All valid match outcome values, for runtime validation. */
export const MATCH_OUTCOMES: readonly MatchOutcome[] = [
  'decided',
  'win',
  'loss',
  'tie',
  'double_loss',
  'bye',
  'unpaired',
  'unknown'
];

// ============================================================================
// Success tags
// ============================================================================

/** One absolute-placement success-tag rule (e.g. top8 needs >=16 players). */
export interface PlacementTagRule {
  tag: string;
  maxPlacing: number;
  minPlayers: number;
}

/** One percentile success-tag rule (e.g. top10 = top 10% of >=20 players). */
export interface PercentTagRule {
  tag: string;
  fraction: number;
  minPlayers: number;
}

/**
 * Versioned success-tag policy. The placement and percent rules are identical to
 * the (previously duplicated) rules in `download-tournament.py` and
 * `run-online-meta.mjs`; the cutoff uses the same ceiling as both producers.
 */
export interface SuccessTagPolicy {
  version: number;
  placementRules: PlacementTagRule[];
  percentRules: PercentTagRule[];
}

/** The frozen v1 success-tag policy. */
export const SUCCESS_TAG_POLICY: SuccessTagPolicy = {
  version: 1,
  placementRules: [
    { tag: 'winner', maxPlacing: 1, minPlayers: 2 },
    { tag: 'top2', maxPlacing: 2, minPlayers: 4 },
    { tag: 'top4', maxPlacing: 4, minPlayers: 8 },
    { tag: 'top8', maxPlacing: 8, minPlayers: 16 },
    { tag: 'top16', maxPlacing: 16, minPlayers: 32 }
  ],
  percentRules: [
    { tag: 'top10', fraction: 0.1, minPlayers: 20 },
    { tag: 'top25', fraction: 0.25, minPlayers: 12 },
    { tag: 'top50', fraction: 0.5, minPlayers: 8 }
  ]
};

/**
 * Compute success tags for a placement in a field of `fieldSize` players. The
 * placement/percent tags come from the policy; `phase2`/`topcut` are appended
 * only for Labs events (`appendPhaseTags`), matching the D7 divergence where
 * online windows never emit them. Tags are returned in policy order:
 * placement rules, then percent rules, then phase2, then topcut.
 * @param placement - Finishing position (1-based) or null
 * @param fieldSize - Total players in the event or null
 * @param options - Phase flags and whether to append phase tags
 * @param options.madePhase2 - Whether the pilot reached phase 2 / Day 2
 * @param options.madeTopCut - Whether the pilot reached the top cut
 * @param options.appendPhaseTags - Append phase2/topcut (Labs events only)
 * @param policy - Success-tag policy (defaults to {@link SUCCESS_TAG_POLICY})
 * @returns Ordered, de-duplicated success tags
 */
export function computeSuccessTags(
  placement: number | null | undefined,
  fieldSize: number | null | undefined,
  options: { madePhase2?: boolean; madeTopCut?: boolean; appendPhaseTags?: boolean } = {},
  policy: SuccessTagPolicy = SUCCESS_TAG_POLICY
): string[] {
  const place = Number.isFinite(placement) ? Number(placement) : null;
  const field = Number.isFinite(fieldSize) ? Number(fieldSize) : null;
  const tags: string[] = [];

  if (place !== null && field !== null && place > 0 && field > 1) {
    for (const rule of policy.placementRules) {
      if (field >= rule.minPlayers && place <= rule.maxPlacing) {
        tags.push(rule.tag);
      }
    }
    for (const rule of policy.percentRules) {
      if (field < rule.minPlayers) {
        continue;
      }
      const cutoff = Math.max(1, Math.ceil(field * rule.fraction));
      if (place <= cutoff) {
        tags.push(rule.tag);
      }
    }
  }

  if (options.appendPhaseTags) {
    if (options.madePhase2 && !tags.includes('phase2')) {
      tags.push('phase2');
    }
    if (options.madeTopCut && !tags.includes('topcut')) {
      tags.push('topcut');
    }
  }

  return tags;
}

// ============================================================================
// Card identity
// ============================================================================

/**
 * A canonical card's identity. When set/number are present, `uid` is
 * `Name::SET::NUMBER` and MUST agree with them; otherwise `uid` is the bare name
 * (name-only basic energy) and set/number are null.
 */
export interface CardIdentity {
  uid: string;
  name: string;
  set: string | null;
  number: string | null;
}

/**
 * A specific physical printing as it appeared in a source decklist. Distinct
 * from {@link CardIdentity}: a synonym rewrite can collapse several printings
 * into one canonical card, so a printing's set/number may differ from the
 * canonical card's. Printings always carry a concrete set and number.
 */
export interface CardPrinting {
  uid: string;
  name: string;
  set: string;
  number: string;
}

/** A canonical card in a deck, with the source printings that collapsed into it. */
export interface DeckCard {
  /** Canonical card identity (post-synonym). Unique within a deck. */
  canonical: CardIdentity;
  /** Distinct source printings that resolved to this canonical card; may be empty for name-only energy. */
  printings: CardPrinting[];
  /** Total copies across all printings (>=1). */
  count: number;
  category: CardCategory;
  trainerType?: TrainerType | null;
  energyType?: EnergyType | null;
  aceSpec?: boolean;
  /** Single uppercase regulation-mark letter (e.g. "H"), or null. */
  regulationMark?: string | null;
}

// ============================================================================
// Archetype identity
// ============================================================================

/** Archetype identity triple: comparison key, display label, URL slug. */
export interface ArchetypeIdentity {
  /** Lowercased, whitespace-collapsed comparison key. */
  key: string;
  /** Cased display label, preserved as first seen. */
  displayName: string;
  /** URL-safe slug derived from the key (not from a sanitized display label). */
  slug: string;
}

// ============================================================================
// Event records
// ============================================================================

/** Win/loss/tie record for a participant. */
export interface ParticipantRecord {
  wins: number;
  losses: number;
  ties: number;
}

/** Boolean participant flags. */
export interface ParticipantFlags {
  madePhase2: boolean;
  madeTopCut: boolean;
  dropped: boolean;
  dqed: boolean;
  late: boolean;
  decklistPublished: boolean;
}

/** A tournament participant / online pilot. */
export interface Participant {
  participantId: string;
  /** Global Limitless player id/handle, when known. */
  playerRef: string | null;
  name: string;
  country: string | null;
  /** Finishing position, 1-based; null when unranked. */
  placement: number | null;
  record: ParticipantRecord;
  /** Opponents' win percentage, 0-100, or null. */
  opwPct: number | null;
  /** Opponents' opponents' win percentage, 0-100, or null. */
  oopwPct: number | null;
  flags: ParticipantFlags;
  /** Resolves to a deck in `decks[]`, or null when no decklist. */
  deckId: string | null;
}

/** A normalized deck (one published decklist). */
export interface Deck {
  schemaVersion: number;
  deckId: string;
  /** Resolves to a participant in `participants[]`. */
  participantId: string;
  playerRef: string | null;
  archetype: ArchetypeIdentity;
  cards: DeckCard[];
  hasDecklist: boolean;
  successTags: string[];
}

/** A canonical, perspective-free match. */
export interface Match {
  schemaVersion: number;
  matchId: string;
  round: number;
  phase: number;
  table: number | null;
  /** One participant for a bye/unpaired row, two otherwise. */
  participantIds: string[];
  outcome: MatchOutcome;
  /** Set only for a `decided` match; resolves to one of `participantIds`. */
  winnerParticipantId: string | null;
  completed: boolean;
}

/** Provenance for one source capture that fed this event. */
export interface SourceRevision {
  source: string;
  entityId: string;
  sourceHash: string;
  /** Source fetch time; volatile, excluded from semantic hashes. */
  fetchedAt: string;
}

/** Event-level metadata common to both kinds. */
export interface EventMeta {
  name: string;
  /** ISO date. */
  date: string;
  /** Field size (players), integer >=0. */
  playerCount: number;
  format: string | null;
  division: string | null;
  /** Whether the event had a Day 2 / phase 2. */
  hasDay2: boolean;
  /** Online windows only: ISO window bounds. */
  windowStart?: string | null;
  windowEnd?: string | null;
}

/** The normalized event record — one schema for both sources. */
export interface NormalizedEvent {
  schemaVersion: number;
  eventId: string;
  kind: NormalizedEventKind;
  meta: EventMeta;
  participants: Participant[];
  decks: Deck[];
  /** Canonical matches; always `[]` for online windows (structural asymmetry). */
  matches: Match[];
  sourceRevisions: SourceRevision[];
}

// ============================================================================
// Stable ID constructors
// ============================================================================

/**
 * Build a stable event id: `labs:{code}` or `online:{windowId}`. Not the R2
 * folder name.
 * @param kind - Event kind
 * @param code - Labs event code or online window id
 * @returns Stable event id
 */
export function eventId(kind: NormalizedEventKind, code: string): string {
  const prefix = kind === 'labs-event' ? 'labs' : 'online';
  return `${prefix}:${code}`;
}

/**
 * Event-scoped participant id for a Labs event: `{eventId}:{tpId}`.
 * @param scopedEventId - The event id
 * @param tpId - Tournament-participant id
 * @returns Participant id
 */
export function labsParticipantId(scopedEventId: string, tpId: string | number): string {
  return `${scopedEventId}:${tpId}`;
}

/**
 * Event-scoped participant id for an online window, keyed by player handle.
 * @param scopedEventId - The event id
 * @param handle - Limitless player handle
 * @returns Participant id
 */
export function onlineParticipantId(scopedEventId: string, handle: string): string {
  return `${scopedEventId}:${handle}`;
}

/** Parsed pieces of a card UID. */
export interface ParsedCardUid {
  name: string;
  set: string | null;
  number: string | null;
}

/**
 * Build a canonical card UID from name/set/number. Set is uppercased and number
 * padded via {@link normalizeCardNumber}; a bare name is returned when set or
 * number are absent.
 * @param name - Card name
 * @param set - Set code
 * @param number - Card number
 * @returns Canonical UID
 */
export function cardUid(
  name: string,
  set: string | null | undefined,
  number: string | number | null | undefined
): string {
  const [canonSet, canonNumber] = canonicalizeVariant(set, number);
  return canonSet && canonNumber ? `${name}::${canonSet}::${canonNumber}` : name;
}

/**
 * Parse a card UID. Returns null when the shape is neither a bare name nor a
 * three-part `Name::SET::NUMBER` with non-empty parts.
 * @param uid - The UID to parse
 * @returns Parsed pieces, or null if malformed
 */
export function parseCardUid(uid: string): ParsedCardUid | null {
  if (typeof uid !== 'string' || uid.length === 0) {
    return null;
  }
  const parts = uid.split('::');
  if (parts.length === 1) {
    return { name: parts[0], set: null, number: null };
  }
  if (parts.length === 3) {
    if (!parts[0] || !parts[1] || !parts[2]) {
      return null;
    }
    return { name: parts[0], set: parts[1], number: parts[2] };
  }
  return null;
}

/**
 * Derive an archetype comparison key: whitespace-collapsed, underscore-to-space,
 * lowercased. Reuses {@link normalizeArchetypeName}; empty names become
 * `"unknown"`.
 * @param displayName - The display label
 * @returns Comparison key
 */
export function archetypeKey(displayName: string | null | undefined): string {
  return normalizeArchetypeName(displayName);
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

/** Minimal card shape needed to compute a deck's content hash. */
export interface DeckIdCard {
  canonical: { uid: string };
  count: number;
}

/**
 * Content-addressed deck id, stable across reruns and independent of card
 * order. Cards are reduced to (canonical uid, count), sorted by uid, then
 * hashed together with the participant id. The hash function is injected so
 * this module stays environment-neutral — callers pass `sha256Hex` from
 * `shared/data/hash.ts`.
 * @param participantId - The owning participant id
 * @param cards - The deck's cards
 * @param hashValue - Hash function over a value's canonical serialization
 * @returns Deck id of the form `sha256:{hex}`
 */
export function deckId(participantId: string, cards: DeckIdCard[], hashValue: (value: unknown) => string): string {
  const cardKeys = cards
    .map(card => ({ uid: card.canonical.uid, count: card.count }))
    .sort((left, right) => (left.uid < right.uid ? -1 : left.uid > right.uid ? 1 : left.count - right.count));
  return `sha256:${hashValue({ schemaVersion: SCHEMA_VERSION, participantId, cards: cardKeys })}`;
}

/**
 * Canonical match key: `r{round}:p{phase}:solo:{id}` for a single-participant
 * row, else `r{round}:p{phase}:{lo}:{hi}` with participant ids sorted so the key
 * is perspective-free.
 * @param round - Round number
 * @param phase - Phase number
 * @param participantIds - One or two participant ids
 * @returns Canonical match id
 */
export function matchId(round: number, phase: number, participantIds: string[]): string {
  const ids = [...participantIds].sort();
  const pair = ids.length === 1 ? `solo:${ids[0]}` : `${ids[0]}:${ids[1]}`;
  return `r${round}:p${phase}:${pair}`;
}

// ============================================================================
// Runtime validation
// ============================================================================

/** Result of validating a normalized record. */
export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function pushDuplicate(seen: Set<string>, id: string, label: string, errors: string[]): void {
  if (seen.has(id)) {
    errors.push(`${label}: duplicate stable id "${id}"`);
  } else {
    seen.add(id);
  }
}

function validateCardIdentity(identity: unknown, path: string, errors: string[]): void {
  if (!isRecord(identity)) {
    errors.push(`${path}: expected object`);
    return;
  }
  const { uid } = identity;
  if (typeof uid !== 'string' || uid.length === 0) {
    errors.push(`${path}.uid: expected non-empty string`);
    return;
  }
  const parsed = parseCardUid(uid);
  if (!parsed) {
    errors.push(`${path}.uid: unparseable UID "${uid}"`);
    return;
  }
  if (identity.name !== parsed.name) {
    errors.push(`${path}.name: "${String(identity.name)}" does not match UID name "${parsed.name}"`);
  }
  const set = identity.set === undefined ? null : identity.set;
  const number = identity.number === undefined ? null : identity.number;
  if (set !== parsed.set) {
    errors.push(`${path}.set: "${String(set)}" does not match UID set "${String(parsed.set)}"`);
  }
  if (number !== parsed.number) {
    errors.push(`${path}.number: "${String(number)}" does not match UID number "${String(parsed.number)}"`);
  }
  if (parsed.number !== null && parsed.number !== normalizeCardNumber(parsed.number)) {
    errors.push(`${path}.number: "${parsed.number}" is not canonical padded form`);
  }
}

function validatePrinting(printing: unknown, path: string, errors: string[]): void {
  if (!isRecord(printing)) {
    errors.push(`${path}: expected object`);
    return;
  }
  const { uid } = printing;
  if (typeof uid !== 'string' || uid.length === 0) {
    errors.push(`${path}.uid: expected non-empty string`);
    return;
  }
  const parsed = parseCardUid(uid);
  if (!parsed || parsed.set === null || parsed.number === null) {
    errors.push(`${path}.uid: printing requires a Name::SET::NUMBER UID, got "${uid}"`);
    return;
  }
  if (printing.set !== parsed.set) {
    errors.push(`${path}.set: "${String(printing.set)}" does not match UID set "${parsed.set}"`);
  }
  if (printing.number !== parsed.number) {
    errors.push(`${path}.number: "${String(printing.number)}" does not match UID number "${parsed.number}"`);
  }
}

function validateDeckCard(card: unknown, path: string, canonicalUidsInDeck: Set<string>, errors: string[]): void {
  if (!isRecord(card)) {
    errors.push(`${path}: expected object`);
    return;
  }
  validateCardIdentity(card.canonical, `${path}.canonical`, errors);
  if (isRecord(card.canonical) && typeof card.canonical.uid === 'string') {
    const { uid } = card.canonical;
    if (canonicalUidsInDeck.has(uid)) {
      errors.push(`${path}.canonical.uid: canonical card "${uid}" counted more than once in this deck`);
    } else {
      canonicalUidsInDeck.add(uid);
    }
  }
  if (!Array.isArray(card.printings)) {
    errors.push(`${path}.printings: expected array`);
  } else {
    card.printings.forEach((printing, index) => {
      validatePrinting(printing, `${path}.printings[${index}]`, errors);
    });
  }
  if (!isInteger(card.count) || card.count < 1) {
    errors.push(`${path}.count: expected integer >= 1`);
  }
  const categories: CardCategory[] = ['pokemon', 'trainer', 'energy'];
  if (!categories.includes(card.category as CardCategory)) {
    errors.push(`${path}.category: invalid category "${String(card.category)}"`);
  }
}

function validateArchetype(archetype: unknown, path: string, errors: string[]): void {
  if (!isRecord(archetype)) {
    errors.push(`${path}: expected object`);
    return;
  }
  const { key, displayName, slug } = archetype;
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

function validateParticipant(participant: unknown, index: number, ids: Set<string>, errors: string[]): void {
  const path = `participants[${index}]`;
  if (!isRecord(participant)) {
    errors.push(`${path}: expected object`);
    return;
  }
  if (typeof participant.participantId !== 'string' || participant.participantId.length === 0) {
    errors.push(`${path}.participantId: expected non-empty string`);
  } else {
    pushDuplicate(ids, participant.participantId, path, errors);
  }
  if (typeof participant.name !== 'string') {
    errors.push(`${path}.name: expected string`);
  }
  const { placement } = participant;
  if (placement !== null && placement !== undefined && (!isInteger(placement) || placement < 1)) {
    errors.push(`${path}.placement: expected integer >= 1 or null`);
  }
  if (!isRecord(participant.record)) {
    errors.push(`${path}.record: expected object`);
  }
  if (!isRecord(participant.flags)) {
    errors.push(`${path}.flags: expected object`);
  }
}

function validateDeck(
  deck: unknown,
  index: number,
  ids: Set<string>,
  participantIds: Set<string>,
  errors: string[]
): void {
  const path = `decks[${index}]`;
  if (!isRecord(deck)) {
    errors.push(`${path}: expected object`);
    return;
  }
  if (deck.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`${path}.schemaVersion: expected ${SCHEMA_VERSION}`);
  }
  if (typeof deck.deckId !== 'string' || deck.deckId.length === 0) {
    errors.push(`${path}.deckId: expected non-empty string`);
  } else {
    pushDuplicate(ids, deck.deckId, path, errors);
  }
  if (typeof deck.participantId !== 'string' || deck.participantId.length === 0) {
    errors.push(`${path}.participantId: expected non-empty string`);
  } else if (!participantIds.has(deck.participantId)) {
    errors.push(`${path}.participantId: unresolved participant "${deck.participantId}"`);
  }
  validateArchetype(deck.archetype, `${path}.archetype`, errors);
  if (!Array.isArray(deck.cards)) {
    errors.push(`${path}.cards: expected array`);
  } else {
    const canonicalUidsInDeck = new Set<string>();
    deck.cards.forEach((card, cardIndex) => {
      validateDeckCard(card, `${path}.cards[${cardIndex}]`, canonicalUidsInDeck, errors);
    });
  }
  if (typeof deck.hasDecklist !== 'boolean') {
    errors.push(`${path}.hasDecklist: expected boolean`);
  }
  if (!Array.isArray(deck.successTags)) {
    errors.push(`${path}.successTags: expected array`);
  }
}

function validateMatch(
  match: unknown,
  index: number,
  ids: Set<string>,
  participantIds: Set<string>,
  errors: string[]
): void {
  const path = `matches[${index}]`;
  if (!isRecord(match)) {
    errors.push(`${path}: expected object`);
    return;
  }
  if (match.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`${path}.schemaVersion: expected ${SCHEMA_VERSION}`);
  }
  if (typeof match.matchId !== 'string' || match.matchId.length === 0) {
    errors.push(`${path}.matchId: expected non-empty string`);
  } else {
    pushDuplicate(ids, match.matchId, path, errors);
  }
  if (!MATCH_OUTCOMES.includes(match.outcome as MatchOutcome)) {
    errors.push(`${path}.outcome: invalid outcome "${String(match.outcome)}"`);
  }
  const memberIds = match.participantIds;
  if (!Array.isArray(memberIds) || memberIds.length < 1 || memberIds.length > 2) {
    errors.push(`${path}.participantIds: expected 1 or 2 participant ids`);
  } else {
    memberIds.forEach((memberId, memberIndex) => {
      if (typeof memberId !== 'string' || !participantIds.has(memberId)) {
        errors.push(`${path}.participantIds[${memberIndex}]: unresolved participant "${String(memberId)}"`);
      }
    });
  }
  const winner = match.winnerParticipantId;
  if (winner !== null && winner !== undefined) {
    if (typeof winner !== 'string' || !participantIds.has(winner)) {
      errors.push(`${path}.winnerParticipantId: unresolved participant "${String(winner)}"`);
    } else if (Array.isArray(memberIds) && !memberIds.includes(winner)) {
      errors.push(`${path}.winnerParticipantId: winner "${winner}" is not a match participant`);
    }
  }
  if (match.outcome === 'decided' && (winner === null || winner === undefined)) {
    errors.push(`${path}.winnerParticipantId: required for a decided match`);
  }
}

/**
 * Validate an unknown value as a {@link NormalizedEvent}: structural checks plus
 * the referential/invariant checks from the contract design (participants and
 * matches resolve, no duplicate stable IDs, placement >= 1, UIDs parse and
 * set/number agree, canonical cards counted once per deck, valid outcomes,
 * archetype key/slug agree with the display name). All errors are collected;
 * validation never stops at the first.
 * @param value - The value to validate
 * @returns `{ ok: true, value }` or `{ ok: false, errors }`
 */
export function validateNormalizedEvent(value: unknown): ValidationResult<NormalizedEvent> {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ['root: expected object'] };
  }

  if (value.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`root.schemaVersion: expected ${SCHEMA_VERSION}`);
  }
  if (typeof value.eventId !== 'string' || value.eventId.length === 0) {
    errors.push('root.eventId: expected non-empty string');
  }
  const { kind } = value;
  if (kind !== 'labs-event' && kind !== 'online-window') {
    errors.push(`root.kind: invalid kind "${String(kind)}"`);
  }
  if (!isRecord(value.meta)) {
    errors.push('root.meta: expected object');
  } else if (!isInteger(value.meta.playerCount) || value.meta.playerCount < 0) {
    errors.push('root.meta.playerCount: expected integer >= 0');
  }

  const participants = Array.isArray(value.participants) ? value.participants : null;
  if (!participants) {
    errors.push('root.participants: expected array');
  }
  const decks = Array.isArray(value.decks) ? value.decks : null;
  if (!decks) {
    errors.push('root.decks: expected array');
  }
  const matches = Array.isArray(value.matches) ? value.matches : null;
  if (!matches) {
    errors.push('root.matches: expected array');
  }
  if (!Array.isArray(value.sourceRevisions)) {
    errors.push('root.sourceRevisions: expected array');
  }

  const participantIds = new Set<string>();
  if (participants) {
    participants.forEach((participant, index) => validateParticipant(participant, index, participantIds, errors));
  }

  const deckIds = new Set<string>();
  if (decks) {
    decks.forEach((deck, index) => validateDeck(deck, index, deckIds, participantIds, errors));
  }

  // Participant.deckId must resolve to a deck (checked after deck ids collected).
  if (participants) {
    participants.forEach((participant, index) => {
      if (isRecord(participant)) {
        const ref = participant.deckId;
        if (ref !== null && ref !== undefined && (typeof ref !== 'string' || !deckIds.has(ref))) {
          errors.push(`participants[${index}].deckId: unresolved deck "${String(ref)}"`);
        }
      }
    });
  }

  const matchIds = new Set<string>();
  if (matches) {
    matches.forEach((match, index) => validateMatch(match, index, matchIds, participantIds, errors));
  }

  // Structural asymmetry (D11): online windows carry no match data.
  if (kind === 'online-window' && matches && matches.length > 0) {
    errors.push('root.matches: online windows must have an empty matches array');
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, value: value as unknown as NormalizedEvent };
}
