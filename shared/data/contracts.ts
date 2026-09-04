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
 * - The card catalog ({@link CardRecord}, validated by {@link
 *   validateCardRecord}) is the normalized "cards table": first-class card
 *   attributes (stage, mechanicSubtypes, structured weakness/resistance, hp, …)
 *   scraped into card-types.json keyed by `SET::NUMBER`.
 *
 * IMPORTANT: this module is environment-neutral (browser + Node + Workers). It
 * must not import `node:crypto`; the {@link deckId} constructor takes a hash
 * function so callers can supply `sha256Hex` from `shared/data/hash.ts`.
 * @module shared/data/contracts
 */

import { normalizeCardNumber, parseCardUid } from './cardIdentity';
import { validateArchetypeIdentity } from './archetypes/identity';
import {
  checkArrayOf,
  checkFields,
  type FieldSpec,
  isBoolean,
  isFiniteInRange,
  isInteger,
  isIntegerAtLeast,
  isMemberOf,
  isNonEmptyString,
  isRecord,
  isStringArray,
  orNull,
  required,
  whenPresent
} from './validate';

// Archetype identity policy (key/displayName/slug triple) lives in
// shared/data/archetypes/identity.ts (DB-MASTER-PLAN Phase 2, slice 5). These
// re-exports keep contracts.ts's public API intact for existing importers.
export { archetypeKey, archetypeSlug, makeArchetypeIdentity } from './archetypes/identity';

/** Schema version stamped on every top-level normalized record. */
export const SCHEMA_VERSION = 1;

// ============================================================================
// Enums / literal unions
// ============================================================================

/** Data source shape for a normalized event. */
export type NormalizedEventKind = 'labs-event' | 'online-window';

/** Top-level card category. */
export type CardCategory = 'pokemon' | 'trainer' | 'energy';

/** All valid card categories, for runtime validation. */
export const CARD_CATEGORIES: readonly CardCategory[] = ['pokemon', 'trainer', 'energy'];

/** Trainer subtype (present only when category is `trainer`). */
export type TrainerType = 'supporter' | 'item' | 'stadium' | 'tool';

/** Energy subtype (present only when category is `energy`). */
export type EnergyType = 'basic' | 'special';

/**
 * Structured evolution stage for a Pokémon card. Vocabulary derived from the
 * observed Limitless type-line segments in card-types.json (Basic, Stage 1,
 * Stage 2, VSTAR, VMAX, Level Up).
 */
export type CardStage = 'basic' | 'stage1' | 'stage2' | 'vstar' | 'vmax' | 'levelUp';

/** All valid card stages, for runtime validation. */
export const CARD_STAGES: readonly CardStage[] = ['basic', 'stage1', 'stage2', 'vstar', 'vmax', 'levelUp'];

/**
 * Card mechanic subtype (from the name/type line). VSTAR/VMAX are observable
 * offline from the stage; the rest live only in the card name.
 */
export type CardMechanicSubtype = 'Mega' | 'Tera' | 'Radiant' | 'ex' | 'VMAX' | 'VSTAR' | 'V';

/** All valid mechanic subtypes, for runtime validation. */
export const CARD_MECHANIC_SUBTYPES: readonly CardMechanicSubtype[] = [
  'Mega',
  'Tera',
  'Radiant',
  'ex',
  'VMAX',
  'VSTAR',
  'V'
];

/**
 * Perspective-free canonical match outcome. `decided` marks a match with a
 * single winner (named by {@link Match.winnerParticipantId}). `tie`,
 * `double_loss` and `decided` are two-participant rows; `bye`/`unpaired`/
 * `unknown` are solo (single-participant) rows. Per-side win/loss values are a
 * SEPARATE union ({@link MatchSideOutcome}) for later per-side derivations — a
 * canonical Match record never carries win/loss.
 */
export type MatchOutcome = 'decided' | 'tie' | 'double_loss' | 'bye' | 'unpaired' | 'unknown';

/**
 * Per-side outcome for later derivations; never stored on a canonical Match.
 * Contract surface ahead of its consumers (see {@link MatchOutcome}'s doc).
 * @public
 */
export type MatchSideOutcome = 'win' | 'loss';

/** All valid canonical match outcome values, for runtime validation. */
export const MATCH_OUTCOMES: readonly MatchOutcome[] = ['decided', 'tie', 'double_loss', 'bye', 'unpaired', 'unknown'];

/** Canonical outcomes that name exactly two participants. */
const PAIR_OUTCOMES: ReadonlySet<string> = new Set<MatchOutcome>(['decided', 'tie', 'double_loss']);

/** Canonical outcomes that name exactly one participant. */
const SOLO_OUTCOMES: ReadonlySet<string> = new Set<MatchOutcome>(['bye', 'unpaired', 'unknown']);

/** Membership sets for O(1) runtime validation. */
const CARD_CATEGORY_SET: ReadonlySet<string> = new Set(CARD_CATEGORIES);
const MATCH_OUTCOME_SET: ReadonlySet<string> = new Set(MATCH_OUTCOMES);
const TRAINER_TYPE_SET: ReadonlySet<string> = new Set<TrainerType>(['supporter', 'item', 'stadium', 'tool']);
const ENERGY_TYPE_SET: ReadonlySet<string> = new Set<EnergyType>(['basic', 'special']);

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
 * the retired `run-online-meta.mjs`; the cutoff uses the same ceiling as both.
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
    // The placement/percent branch never emits phase2/topcut, so these append
    // unconditionally within the phase-tags branch (no dedupe guard needed).
    if (options.madePhase2) {
      tags.push('phase2');
    }
    if (options.madeTopCut) {
      tags.push('topcut');
    }
  }

  return tags;
}

/**
 * Ordered placement- and percent-tier tag names emitted by
 * {@link SUCCESS_TAG_POLICY} (the Labs-only `phase2`/`topcut` phase tags are
 * excluded). This is the canonical taxonomy consumers iterate when they need a
 * literal-typed tier list; a test pins it to the policy so the two cannot
 * drift. See divergence D7.
 */
export const SUCCESS_TAG_NAMES = ['winner', 'top2', 'top4', 'top8', 'top16', 'top10', 'top25', 'top50'] as const;

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
// Card catalog (metadata "cards table")
// ============================================================================

/** A structured Weakness/Resistance entry: energy type + optional modifier. */
export interface WeaknessResistance {
  /** Energy type name as printed (e.g. "Fighting", "Fire"). */
  type: string;
  /** Modifier token as printed, whitespace-stripped ("×2", "-30"), or null. */
  modifier: string | null;
}

/** A card's ability text detail (name + effect). */
export interface CardAbilityDetail {
  name: string;
  effect: string | null;
}

/** A card's attack detail (energy cost, name, damage, effect). */
export interface CardAttackDetail {
  cost: string | null;
  name: string;
  damage: string | null;
  effect: string | null;
}

/**
 * Normalized card-catalog record — the "cards table" shape backing the metadata
 * scraped into card-types.json (keyed `SET::NUMBER`) by build-card-types.mjs.
 * Only the identity fields (`cardType`, `fullType`, `metadataVersion`) are
 * required; every other attribute is optional because Limitless pages, and
 * older scrapes, populate different subsets. Structured fields (`stage`,
 * `mechanicSubtypes`, `weakness`/`resistance`) are the v2 additions modeled for
 * the DB migration.
 */
export interface CardRecord {
  /** Parser schema version stamped on the entry. */
  metadataVersion: number;
  /** Top-level category ("pokemon" | "trainer" | "energy"). */
  cardType: CardCategory;
  /** Trainer/energy subtype, or a free label; null for most Pokémon. */
  subType?: string | null;
  /** Raw evolution/type line for Pokémon (e.g. "Stage 2 - Evolves from Kirlia"). */
  evolutionInfo?: string | null;
  /** The full type line joined with " - " (e.g. "Pokémon - Basic"). */
  fullType: string;
  /** Structured evolution stage (Pokémon only). */
  stage?: CardStage;
  /** Mechanic subtypes parsed from the name/type line. */
  mechanicSubtypes?: CardMechanicSubtype[];
  aceSpec?: true;
  /** Single uppercase regulation-mark letter (e.g. "H"). */
  regulationMark?: string;
  abilities?: string[];
  attacks?: string[];
  hp?: number;
  pokemonType?: string;
  weakness?: WeaknessResistance;
  resistance?: WeaknessResistance;
  retreatCost?: number;
  rarity?: string;
  artist?: string;
  text?: string;
  abilityDetails?: CardAbilityDetail[];
  attackDetails?: CardAttackDetail[];
  /** Format legality map ("standard"/"expanded" → "legal"/…). */
  legality?: Record<string, string>;
  /** ISO timestamp of the last scrape/upgrade of this entry. */
  lastUpdated?: string;
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
  /**
   * Opponents' win percentage on a 0-100 scale, or null. NOTE: Labs standings
   * emit this as a 0-1 fraction (`download-tournament.py` stores the raw `opw`
   * with no scaling); the source→normalized adapter is responsible for the
   * ×100 conversion. The contract — and its validator range — is always 0-100.
   */
  opwPct: number | null;
  /** Opponents' opponents' win percentage on the same 0-100 scale (see {@link Participant.opwPct}). */
  oopwPct: number | null;
  /** Swiss match points; integer >= 0, or null when unknown. Labs source field. */
  points?: number | null;
  /**
   * Labs deck-icon slugs (e.g. `["charizard", "pidgeot"]`); each entry a
   * non-empty string. Source-assigned and labs-only — absent for online
   * windows. May be an empty array.
   */
  icons?: string[];
  /**
   * Round the pilot dropped; integer >= 1, or null. Only meaningful when
   * {@link ParticipantFlags.dropped} — a non-null `dropRound` REQUIRES
   * `flags.dropped === true` (cross-validated).
   */
  dropRound?: number | null;
  /**
   * Labs-assigned deck identifier and its human label, taken verbatim from the
   * source standings. DISTINCT from {@link Participant.deckId}: that is the
   * content-addressed hash of the deck's cards ({@link deckId}), whereas
   * `labsDeckId`/`deckName` are opaque source strings that take NO part in
   * canonical deck identity.
   */
  labsDeckId?: string | null;
  deckName?: string | null;
  flags: ParticipantFlags;
  /** Resolves to a deck in `decks[]`, or null when no decklist. Content hash, NOT the Labs `labsDeckId`. */
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
  /** Host country (Labs). Non-empty string or null. */
  country?: string | null;
  /** Host city (Labs). Non-empty string or null. */
  city?: string | null;
  /** Labs event `type` (e.g. "regional"). Non-empty string or null. */
  eventType?: string | null;
  /**
   * Source last-updated timestamp (Labs `updated_at`). SOURCE metadata — fine to
   * store, but VOLATILE: it MUST be excluded from any semantic hash, exactly
   * like {@link SourceRevision.fetchedAt}.
   */
  updatedAt?: string | null;
  /** Whether the source marks the event completed (Labs). */
  completed?: boolean;
  /** Whether the source marks the event started (Labs). */
  started?: boolean;
  /** Players at round 1 (Labs `players_r1`); integer >= 0 or null. */
  playersRound1?: number | null;
  /** Published decklist count (Labs `decklists`); integer >= 0 or null. */
  decklistCount?: number | null;
  /** External RK9 id; non-empty string or null. */
  rk9Id?: string | null;
  /** External Play! LATAM id; non-empty string or null. */
  playlatamId?: string | null;
  /** Labs event code (e.g. "0001"); non-empty string or null. */
  labsCode?: string | null;
  /** Labs numeric tournament id as a string; non-empty string or null. */
  sourceTournamentId?: string | null;
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
 * Validate and normalize one id-constructor input segment. Rejects
 * empty/whitespace-only strings, non-finite numbers, and any other type; also
 * rejects the `|` character, which is reserved as the {@link matchId} pair
 * delimiter and must not appear inside a segment.
 * @param value - The raw segment
 * @param label - Segment name, for error messages
 * @returns The segment coerced to a string
 * @throws {TypeError} When the segment is empty, non-finite, or contains `|`
 */
function requireIdSegment(value: string | number, label: string): string {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new TypeError(`${label}: expected a finite number`);
  }
  const segment = typeof value === 'number' ? String(value) : value;
  if (typeof segment !== 'string' || segment.trim().length === 0) {
    throw new TypeError(`${label}: expected a non-empty string`);
  }
  if (segment.includes('|')) {
    throw new TypeError(`${label}: must not contain the reserved "|" delimiter`);
  }
  return segment;
}

/**
 * Build a stable event id: `labs:{code}` or `online:{windowId}`. Not the R2
 * folder name.
 * @param kind - Event kind
 * @param code - Labs event code or online window id
 * @returns Stable event id
 * @throws {TypeError} When `code` is empty/whitespace or contains `|`
 */
export function eventId(kind: NormalizedEventKind, code: string): string {
  const prefix = kind === 'labs-event' ? 'labs' : 'online';
  return `${prefix}:${requireIdSegment(code, 'eventId code')}`;
}

/**
 * Event-scoped participant id for a Labs event: `{eventId}:{tpId}`.
 * @param scopedEventId - The event id
 * @param tpId - Tournament-participant id
 * @returns Participant id
 * @throws {TypeError} When either input is empty/whitespace/non-finite or contains `|`
 */
export function labsParticipantId(scopedEventId: string, tpId: string | number): string {
  const scope = requireIdSegment(scopedEventId, 'labsParticipantId scopedEventId');
  return `${scope}:${requireIdSegment(tpId, 'labsParticipantId tpId')}`;
}

/**
 * Event-scoped participant id for an online window, keyed by player handle.
 * @param scopedEventId - The event id
 * @param handle - Limitless player handle
 * @returns Participant id
 * @throws {TypeError} When either input is empty/whitespace or contains `|`
 */
export function onlineParticipantId(scopedEventId: string, handle: string): string {
  const scope = requireIdSegment(scopedEventId, 'onlineParticipantId scopedEventId');
  return `${scope}:${requireIdSegment(handle, 'onlineParticipantId handle')}`;
}

/** Parsed pieces of a card UID. */
export interface ParsedCardUid {
  name: string;
  set: string | null;
  number: string | null;
}

/**
 * Parse a card UID. Returns null when the shape is neither a bare name nor a
 * three-part `Name::SET::NUMBER` with non-empty parts.
 * @param uid - The UID to parse
 * @returns Parsed pieces, or null if malformed
 */
export function parseCardIdentity(uid: string): ParsedCardUid | null {
  if (typeof uid !== 'string' || uid.length === 0) {
    return null;
  }
  const parsed = parseCardUid(uid);
  if (parsed) {
    return parsed;
  }
  return uid.includes('::') ? null : { name: uid, set: null, number: null };
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
  const scoped = requireIdSegment(participantId, 'deckId participantId');
  const cardKeys = cards
    .map(card => ({ uid: card.canonical.uid, count: card.count }))
    .sort((left, right) => (left.uid < right.uid ? -1 : left.uid > right.uid ? 1 : left.count - right.count));
  return `sha256:${hashValue({ schemaVersion: SCHEMA_VERSION, participantId: scoped, cards: cardKeys })}`;
}

/**
 * Canonical match key: `r{round}:p{phase}:solo:{id}` for a single-participant
 * row, else `r{round}:p{phase}:{lo}|{hi}` with participant ids sorted so the key
 * is perspective-free. The pair delimiter is `|` (not `:`) because participant
 * ids contain `:` internally — `|` removes the structural ambiguity.
 * @param round - Round number (finite)
 * @param phase - Phase number (finite)
 * @param participantIds - One or two participant ids
 * @returns Canonical match id
 * @throws {TypeError} When round/phase are non-finite or an id is empty or contains `|`
 */
export function matchId(round: number, phase: number, participantIds: string[]): string {
  if (!Number.isFinite(round) || !Number.isFinite(phase)) {
    throw new TypeError('matchId: round and phase must be finite numbers');
  }
  const ids = participantIds.map(id => requireIdSegment(id, 'matchId participantId')).sort();
  const pair = ids.length === 1 ? `solo:${ids[0]}` : `${ids[0]}|${ids[1]}`;
  return `r${round}:p${phase}:${pair}`;
}

// ============================================================================
// Runtime validation
// ============================================================================

/** Result of validating a normalized record. */
export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

function pushDuplicate(seen: Set<string>, id: string, label: string, errors: string[]): void {
  if (seen.has(id)) {
    errors.push(`${label}: duplicate stable id "${id}"`);
  } else {
    seen.add(id);
  }
}

// ----------------------------------------------------------------------------
// Field specs
//
// One table per record shape. What lives here is every check that is purely a
// function of a single field's own value; anything that needs a second field,
// a sibling record, or a position in a list stays hand-written in the validator
// below, where the reason for the cross-check can be stated. Message tails are
// verbatim — they are read out of pipeline logs and matched by the contract
// tests, so they are the stable surface, not an implementation detail.
// ----------------------------------------------------------------------------

/** Reused often enough across the Labs-optional fields to be worth naming. */
const NON_EMPTY_STRING_OR_NULL = orNull(isNonEmptyString, 'expected a non-empty string or null');

/** Non-negative integer, or null/absent. */
const NON_NEGATIVE_INTEGER_OR_NULL = orNull(isIntegerAtLeast(0), 'expected a non-negative integer or null');

/** Rules for the scalar fields of a participant. */
const PARTICIPANT_SPEC: FieldSpec = {
  participantId: required(isNonEmptyString, 'expected non-empty string'),
  name: required(value => typeof value === 'string', 'expected string'),
  placement: orNull(isIntegerAtLeast(1), 'expected integer >= 1 or null'),
  opwPct: orNull(isFiniteInRange(0, 100), 'expected a finite number in [0, 100] or null'),
  oopwPct: orNull(isFiniteInRange(0, 100), 'expected a finite number in [0, 100] or null'),
  // Labs source fields — online windows omit them entirely.
  points: NON_NEGATIVE_INTEGER_OR_NULL,
  dropRound: orNull(isIntegerAtLeast(1), 'expected integer >= 1 or null'),
  labsDeckId: NON_EMPTY_STRING_OR_NULL,
  deckName: NON_EMPTY_STRING_OR_NULL
};

/** Rules for `participant.record`. */
const PARTICIPANT_RECORD_SPEC: FieldSpec = {
  wins: required(isIntegerAtLeast(0), 'expected a non-negative integer'),
  losses: required(isIntegerAtLeast(0), 'expected a non-negative integer'),
  ties: required(isIntegerAtLeast(0), 'expected a non-negative integer')
};

/** Rules for `participant.flags`. Every flag is required and boolean. */
const PARTICIPANT_FLAGS_SPEC: FieldSpec = {
  madePhase2: required(isBoolean, 'expected boolean'),
  madeTopCut: required(isBoolean, 'expected boolean'),
  dropped: required(isBoolean, 'expected boolean'),
  dqed: required(isBoolean, 'expected boolean'),
  late: required(isBoolean, 'expected boolean'),
  decklistPublished: required(isBoolean, 'expected boolean')
};

/** Rules for `root.meta`. Everything but `playerCount` is Labs-optional. */
const META_SPEC: FieldSpec = {
  playerCount: required(isIntegerAtLeast(0), 'expected integer >= 0'),
  country: NON_EMPTY_STRING_OR_NULL,
  city: NON_EMPTY_STRING_OR_NULL,
  eventType: NON_EMPTY_STRING_OR_NULL,
  updatedAt: NON_EMPTY_STRING_OR_NULL,
  rk9Id: NON_EMPTY_STRING_OR_NULL,
  playlatamId: NON_EMPTY_STRING_OR_NULL,
  labsCode: NON_EMPTY_STRING_OR_NULL,
  sourceTournamentId: NON_EMPTY_STRING_OR_NULL,
  completed: orNull(isBoolean, 'expected boolean or null'),
  started: orNull(isBoolean, 'expected boolean or null'),
  playersRound1: NON_NEGATIVE_INTEGER_OR_NULL,
  decklistCount: NON_NEGATIVE_INTEGER_OR_NULL
};

/** Rules for the scalar fields of a deck. */
const DECK_SPEC: FieldSpec = {
  schemaVersion: required(value => value === SCHEMA_VERSION, `expected ${SCHEMA_VERSION}`),
  hasDecklist: required(isBoolean, 'expected boolean'),
  successTags: required(value => Array.isArray(value), 'expected array')
};

/** Rules for the scalar fields of a deck card. */
const DECK_CARD_SPEC: FieldSpec = {
  count: required(isIntegerAtLeast(1), 'expected integer >= 1'),
  category: required(isMemberOf(CARD_CATEGORY_SET), value => `invalid category "${String(value)}"`),
  aceSpec: orNull(isBoolean, 'expected boolean'),
  regulationMark: orNull(value => /^[A-Z]$/.test(String(value)), 'expected a single uppercase letter')
};

/** Rules for the scalar fields of a match. */
const MATCH_SPEC: FieldSpec = {
  schemaVersion: required(value => value === SCHEMA_VERSION, `expected ${SCHEMA_VERSION}`),
  outcome: required(isMemberOf(MATCH_OUTCOME_SET), value => `invalid outcome "${String(value)}"`),
  round: required(isIntegerAtLeast(1), 'expected integer >= 1'),
  phase: required(isIntegerAtLeast(1), 'expected integer >= 1'),
  table: orNull(isIntegerAtLeast(1), 'expected integer >= 1 or null'),
  completed: required(isBoolean, 'expected boolean')
};

/**
 * Assert an array of extracted keys is in canonical ascending (plain string)
 * order. Non-string keys (from malformed entries whose structural errors were
 * already reported) are skipped rather than compared.
 */
function checkAscending(keys: (string | undefined)[], path: string, label: string, errors: string[]): void {
  for (let i = 1; i < keys.length; i++) {
    const prev = keys[i - 1];
    const cur = keys[i];
    if (typeof prev === 'string' && typeof cur === 'string' && prev > cur) {
      errors.push(`${path}: ${label} not in canonical ascending order (index ${i})`);
      return;
    }
  }
}

/**
 * Shared canonical-identity checks for a card {@link CardIdentity}/{@link
 * CardPrinting}: the uid parses, its name segment matches the record's `name`,
 * its set segment is canonical uppercase, and its number segment is the
 * canonical padded form. Returns the parsed uid (or null when the uid is
 * missing/unparseable so the caller can stop).
 */
function checkUidSegments(record: Record<string, unknown>, path: string, errors: string[]): ParsedCardUid | null {
  const { uid } = record;
  if (typeof uid !== 'string' || uid.length === 0) {
    errors.push(`${path}.uid: expected non-empty string`);
    return null;
  }
  const parsed = parseCardIdentity(uid);
  if (!parsed) {
    errors.push(`${path}.uid: unparseable UID "${uid}"`);
    return null;
  }
  if (record.name !== parsed.name) {
    errors.push(`${path}.name: "${String(record.name)}" does not match UID name "${parsed.name}"`);
  }
  if (parsed.set !== null && parsed.set !== parsed.set.toUpperCase()) {
    errors.push(`${path}.set: "${parsed.set}" is not canonical uppercase form`);
  }
  if (parsed.number !== null && parsed.number !== normalizeCardNumber(parsed.number)) {
    errors.push(`${path}.number: "${parsed.number}" is not canonical padded form`);
  }
  return parsed;
}

function validateCardIdentity(identity: unknown, path: string, errors: string[]): void {
  if (!isRecord(identity)) {
    errors.push(`${path}: expected object`);
    return;
  }
  const parsed = checkUidSegments(identity, path, errors);
  if (!parsed) {
    return;
  }
  const set = identity.set === undefined ? null : identity.set;
  const number = identity.number === undefined ? null : identity.number;
  if (set !== parsed.set) {
    errors.push(`${path}.set: "${String(set)}" does not match UID set "${String(parsed.set)}"`);
  }
  if (number !== parsed.number) {
    errors.push(`${path}.number: "${String(number)}" does not match UID number "${String(parsed.number)}"`);
  }
}

function validatePrinting(printing: unknown, path: string, errors: string[]): void {
  if (!isRecord(printing)) {
    errors.push(`${path}: expected object`);
    return;
  }
  const parsed = checkUidSegments(printing, path, errors);
  if (!parsed) {
    return;
  }
  if (parsed.set === null || parsed.number === null) {
    errors.push(`${path}.uid: printing requires a Name::SET::NUMBER UID, got "${String(printing.uid)}"`);
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
    checkAscending(
      card.printings.map(printing =>
        isRecord(printing) && typeof printing.uid === 'string' ? printing.uid : undefined
      ),
      `${path}.printings`,
      'printings',
      errors
    );
  }
  checkFields(card, path, DECK_CARD_SPEC, errors);
  checkCategorySubtype(card, path, errors);
}

/**
 * `trainerType` and `energyType` are each legal only under their own category,
 * so a bad value has two distinct meanings — wrong category, or an unknown
 * value within the right one — and the reader needs to be told which. That
 * pairing is what keeps these two out of {@link DECK_CARD_SPEC}.
 */
function checkCategorySubtype(card: Record<string, unknown>, path: string, errors: string[]): void {
  const { category, trainerType, energyType } = card;
  const subtypes = [
    { field: 'trainerType', value: trainerType, category: 'trainer', label: 'trainer type', allowed: TRAINER_TYPE_SET },
    { field: 'energyType', value: energyType, category: 'energy', label: 'energy type', allowed: ENERGY_TYPE_SET }
  ] as const;
  for (const subtype of subtypes) {
    if (subtype.value === null || subtype.value === undefined) {
      continue;
    }
    if (category !== subtype.category) {
      errors.push(`${path}.${subtype.field}: only allowed when category is "${subtype.category}"`);
    } else if (!subtype.allowed.has(subtype.value as string)) {
      errors.push(`${path}.${subtype.field}: invalid ${subtype.label} "${String(subtype.value)}"`);
    }
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
  checkFields(participant, path, PARTICIPANT_SPEC, errors);

  if (!isRecord(participant.record)) {
    errors.push(`${path}.record: expected object`);
  } else {
    checkFields(participant.record, `${path}.record`, PARTICIPANT_RECORD_SPEC, errors);
  }
  if (!isRecord(participant.flags)) {
    errors.push(`${path}.flags: expected object`);
  } else {
    checkFields(participant.flags, `${path}.flags`, PARTICIPANT_FLAGS_SPEC, errors);
  }
  if (participant.icons !== null && participant.icons !== undefined) {
    checkArrayOf(
      participant.icons,
      `${path}.icons`,
      'expected an array of non-empty strings',
      required(isNonEmptyString, 'expected a non-empty string'),
      errors
    );
  }
  // Cross-check: a drop round is only meaningful for a dropped participant, so
  // it is validated against flags rather than in isolation.
  const { dropRound } = participant;
  if (dropRound !== null && dropRound !== undefined && isIntegerAtLeast(1)(dropRound)) {
    if (!isRecord(participant.flags) || participant.flags.dropped !== true) {
      errors.push(`${path}.dropRound: non-null dropRound requires flags.dropped to be true`);
    }
  }
}

function validateMeta(meta: Record<string, unknown>, errors: string[]): void {
  checkFields(meta, 'root.meta', META_SPEC, errors);
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
  checkFields(deck, path, DECK_SPEC, errors);
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
  validateArchetypeIdentity(deck.archetype, `${path}.archetype`, errors);
  if (!Array.isArray(deck.cards)) {
    errors.push(`${path}.cards: expected array`);
  } else {
    const canonicalUidsInDeck = new Set<string>();
    deck.cards.forEach((card, cardIndex) => {
      validateDeckCard(card, `${path}.cards[${cardIndex}]`, canonicalUidsInDeck, errors);
    });
    checkAscending(
      deck.cards.map(card =>
        isRecord(card) && isRecord(card.canonical) && typeof card.canonical.uid === 'string'
          ? card.canonical.uid
          : undefined
      ),
      `${path}.cards`,
      'cards',
      errors
    );
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
  checkFields(match, path, MATCH_SPEC, errors);
  if (typeof match.matchId !== 'string' || match.matchId.length === 0) {
    errors.push(`${path}.matchId: expected non-empty string`);
  } else {
    pushDuplicate(ids, match.matchId, path, errors);
  }
  checkMatchMembers(match, path, participantIds, errors);
  checkMatchWinner(match, path, participantIds, errors);
}

/**
 * A match's participant list must resolve, and its arity must agree with the
 * outcome: solo outcomes (bye/unpaired/unknown) name one participant, pair
 * outcomes (decided/tie/double_loss) name two.
 */
function checkMatchMembers(
  match: Record<string, unknown>,
  path: string,
  participantIds: Set<string>,
  errors: string[]
): void {
  const memberIds = match.participantIds;
  if (!Array.isArray(memberIds) || memberIds.length < 1 || memberIds.length > 2) {
    errors.push(`${path}.participantIds: expected 1 or 2 participant ids`);
    return;
  }
  memberIds.forEach((memberId, memberIndex) => {
    if (typeof memberId !== 'string' || !participantIds.has(memberId)) {
      errors.push(`${path}.participantIds[${memberIndex}]: unresolved participant "${String(memberId)}"`);
    }
  });
  const outcome = match.outcome as string;
  if (SOLO_OUTCOMES.has(outcome) && memberIds.length !== 1) {
    errors.push(`${path}.participantIds: outcome "${String(outcome)}" requires exactly 1 participant`);
  }
  if (PAIR_OUTCOMES.has(outcome) && memberIds.length !== 2) {
    errors.push(`${path}.participantIds: outcome "${String(outcome)}" requires exactly 2 participants`);
  }
}

/**
 * `winnerParticipantId` is REQUIRED for a 'decided' match and FORBIDDEN for
 * every other outcome; when present it must resolve and must be one of the
 * match's own participants.
 */
function checkMatchWinner(
  match: Record<string, unknown>,
  path: string,
  participantIds: Set<string>,
  errors: string[]
): void {
  const { outcome } = match;
  const winner = match.winnerParticipantId;
  const hasWinner = winner !== null && winner !== undefined;
  if (hasWinner) {
    const memberIds = match.participantIds;
    if (typeof winner !== 'string' || !participantIds.has(winner)) {
      errors.push(`${path}.winnerParticipantId: unresolved participant "${String(winner)}"`);
    } else if (Array.isArray(memberIds) && !memberIds.includes(winner)) {
      errors.push(`${path}.winnerParticipantId: winner "${winner}" is not a match participant`);
    }
  }
  if (outcome === 'decided' && !hasWinner) {
    errors.push(`${path}.winnerParticipantId: required for a decided match`);
  }
  if (outcome !== 'decided' && hasWinner) {
    errors.push(
      `${path}.winnerParticipantId: forbidden for outcome "${String(outcome)}" (only "decided" names a winner)`
    );
  }
}

/**
 * Rules for the top level of a normalized event. The four collection fields are
 * only checked for being arrays here; their contents are validated by the
 * passes below, which need the whole collection at once.
 */
const EVENT_ROOT_SPEC: FieldSpec = {
  schemaVersion: required(value => value === SCHEMA_VERSION, `expected ${SCHEMA_VERSION}`),
  eventId: required(isNonEmptyString, 'expected non-empty string'),
  kind: required(isMemberOf(['labs-event', 'online-window']), value => `invalid kind "${String(value)}"`),
  participants: required(value => Array.isArray(value), 'expected array'),
  decks: required(value => Array.isArray(value), 'expected array'),
  matches: required(value => Array.isArray(value), 'expected array'),
  sourceRevisions: required(value => Array.isArray(value), 'expected array')
};

/**
 * A collection field as an array, or null when it was not one. The null lets
 * each pass below skip cleanly — the "expected array" complaint has already
 * been recorded by {@link EVENT_ROOT_SPEC}, and re-reporting it per pass would
 * bury the real problem under duplicates.
 */
function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

/** Assert sourceRevisions are in canonical (source, entityId) ascending order. */
function checkSourceRevisionOrder(sourceRevisions: unknown, errors: string[]): void {
  if (!Array.isArray(sourceRevisions)) {
    return;
  }
  checkAscending(
    sourceRevisions.map(revision =>
      isRecord(revision) && typeof revision.source === 'string' && typeof revision.entityId === 'string'
        ? `${revision.source}\u0000${revision.entityId}`
        : undefined
    ),
    'root.sourceRevisions',
    'sourceRevisions',
    errors
  );
}

/**
 * Validate every participant, collecting the id set later passes resolve
 * against and an index from id to record for the successTags cross-check.
 */
function collectParticipants(
  participants: unknown[] | null,
  errors: string[]
): { participantIds: Set<string>; participantById: Map<string, Record<string, unknown>> } {
  const participantIds = new Set<string>();
  const participantById = new Map<string, Record<string, unknown>>();
  if (!participants) {
    return { participantIds, participantById };
  }
  participants.forEach((participant, index) => {
    validateParticipant(participant, index, participantIds, errors);
    if (isRecord(participant) && typeof participant.participantId === 'string') {
      participantById.set(participant.participantId, participant);
    }
  });
  checkAscending(
    participants.map(participant =>
      isRecord(participant) && typeof participant.participantId === 'string' ? participant.participantId : undefined
    ),
    'root.participants',
    'participants',
    errors
  );
  return { participantIds, participantById };
}

/**
 * Validate every deck, collecting the deck id set and an index from id to
 * record. A participant may be claimed by at most one deck, which is checked
 * here because it is the only pass that sees all decks at once.
 */
function collectDecks(
  decks: unknown[] | null,
  participantIds: Set<string>,
  errors: string[]
): { deckIds: Set<string>; deckById: Map<string, Record<string, unknown>> } {
  const deckIds = new Set<string>();
  const deckById = new Map<string, Record<string, unknown>>();
  const deckByParticipant = new Map<string, number>();
  if (!decks) {
    return { deckIds, deckById };
  }
  decks.forEach((deck, index) => {
    validateDeck(deck, index, deckIds, participantIds, errors);
    if (!isRecord(deck) || typeof deck.deckId !== 'string') {
      return;
    }
    deckById.set(deck.deckId, deck);
    if (typeof deck.participantId !== 'string') {
      return;
    }
    if (deckByParticipant.has(deck.participantId)) {
      errors.push(
        `decks[${index}].participantId: participant "${deck.participantId}" is claimed by more than one deck`
      );
    } else {
      deckByParticipant.set(deck.participantId, index);
    }
  });
  checkAscending(
    decks.map(deck => (isRecord(deck) && typeof deck.deckId === 'string' ? deck.deckId : undefined)),
    'root.decks',
    'decks',
    errors
  );
  return { deckIds, deckById };
}

/**
 * `participant.deckId` must resolve to a deck AND that deck must point back at
 * the same participant. Checking only one direction would let a deck and a
 * participant disagree about which of them owns the pairing.
 */
function checkDeckBackReferences(
  participants: unknown[] | null,
  deckIds: Set<string>,
  deckById: Map<string, Record<string, unknown>>,
  errors: string[]
): void {
  if (!participants) {
    return;
  }
  participants.forEach((participant, index) => {
    if (!isRecord(participant)) {
      return;
    }
    const ref = participant.deckId;
    if (ref === null || ref === undefined) {
      return;
    }
    if (typeof ref !== 'string' || !deckIds.has(ref)) {
      errors.push(`participants[${index}].deckId: unresolved deck "${String(ref)}"`);
      return;
    }
    const deck = deckById.get(ref);
    if (deck && deck.participantId !== participant.participantId) {
      errors.push(
        `participants[${index}].deckId: deck "${ref}" back-references participant "${String(deck.participantId)}", not "${String(participant.participantId)}"`
      );
    }
  });
}

/** Validate every match and assert canonical matchId ordering. */
function collectMatches(matches: unknown[] | null, participantIds: Set<string>, errors: string[]): void {
  if (!matches) {
    return;
  }
  const matchIds = new Set<string>();
  matches.forEach((match, index) => validateMatch(match, index, matchIds, participantIds, errors));
  checkAscending(
    matches.map(match => (isRecord(match) && typeof match.matchId === 'string' ? match.matchId : undefined)),
    'root.matches',
    'matches',
    errors
  );
}

/**
 * successTags must equal the policy recomputation exactly, order included, so
 * the artifacts built from them are byte-deterministic. Phase tags append only
 * for Labs events (D7 divergence).
 */
function checkSuccessTagDrift(
  decks: unknown[] | null,
  participantById: Map<string, Record<string, unknown>>,
  playerCount: number | null,
  appendPhaseTags: boolean,
  errors: string[]
): void {
  if (!decks) {
    return;
  }
  decks.forEach((deck, index) => {
    if (!isRecord(deck) || !Array.isArray(deck.successTags) || typeof deck.participantId !== 'string') {
      return;
    }
    const participant = participantById.get(deck.participantId);
    if (!participant || !isRecord(participant.flags)) {
      return;
    }
    const { flags } = participant;
    const placement = typeof participant.placement === 'number' ? participant.placement : null;
    const expected = computeSuccessTags(placement, playerCount, {
      madePhase2: flags.madePhase2 === true,
      madeTopCut: flags.madeTopCut === true,
      appendPhaseTags
    });
    const actual = deck.successTags;
    const drifted = actual.length !== expected.length || expected.some((tag, tagIndex) => actual[tagIndex] !== tag);
    if (drifted) {
      errors.push(
        `decks[${index}].successTags: [${actual.map(String).join(', ')}] does not match policy recomputation [${expected.join(', ')}]`
      );
    }
  });
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

  checkFields(value, 'root', EVENT_ROOT_SPEC, errors);
  if (!isRecord(value.meta)) {
    errors.push('root.meta: expected object');
  } else {
    validateMeta(value.meta, errors);
  }

  const { kind } = value;
  const participants = asArray(value.participants);
  const decks = asArray(value.decks);
  const matches = asArray(value.matches);

  const { participantIds, participantById } = collectParticipants(participants, errors);
  const { deckIds, deckById } = collectDecks(decks, participantIds, errors);
  checkDeckBackReferences(participants, deckIds, deckById, errors);
  collectMatches(matches, participantIds, errors);
  checkSourceRevisionOrder(value.sourceRevisions, errors);

  const playerCount = isRecord(value.meta) && isInteger(value.meta.playerCount) ? value.meta.playerCount : null;
  checkSuccessTagDrift(decks, participantById, playerCount, kind === 'labs-event', errors);

  // Structural asymmetry (D11): online windows carry no match data.
  if (kind === 'online-window' && matches && matches.length > 0) {
    errors.push('root.matches: online windows must have an empty matches array');
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, value: value as unknown as NormalizedEvent };
}

// ============================================================================
// Card catalog validation
// ============================================================================

/** Field rules for a structured Weakness/Resistance. */
const WEAKNESS_RESISTANCE_SPEC: FieldSpec = {
  type: required(isNonEmptyString, 'expected non-empty string'),
  modifier: required(v => v === null || typeof v === 'string', 'expected string or null')
};

/** Validate a structured Weakness/Resistance ({type: string, modifier: string|null}). */
function validateWeaknessResistance(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path}: expected object`);
    return;
  }
  checkFields(value, path, WEAKNESS_RESISTANCE_SPEC, errors);
}

/** `{name, effect}` shape of one entry in `abilityDetails`. */
function isAbilityDetail(value: unknown): boolean {
  return (
    isRecord(value) && typeof value.name === 'string' && (value.effect === null || typeof value.effect === 'string')
  );
}

/** `{cost, name, damage, effect}` shape of one entry in `attackDetails`. */
function isAttackDetail(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    (value.cost === null || typeof value.cost === 'string') &&
    (value.damage === null || typeof value.damage === 'string') &&
    (value.effect === null || typeof value.effect === 'string')
  );
}

/**
 * Field rules for a {@link CardRecord}.
 *
 * Identity (`metadataVersion`, `cardType`, `fullType`) is required. Everything
 * else is a card attribute that a given printing may simply not have, so it is
 * absent-optional: `undefined` skips the check, while an explicit `null` is
 * still wrong for everything except the two fields Limitless genuinely emits as
 * null (`subType`, `evolutionInfo`).
 */
const CARD_RECORD_SPEC: FieldSpec = {
  metadataVersion: required(isIntegerAtLeast(1), 'expected positive integer'),
  cardType: required(isMemberOf(CARD_CATEGORIES), `expected one of ${CARD_CATEGORIES.join('/')}`),
  fullType: required(isNonEmptyString, 'expected non-empty string'),
  subType: orNull(v => typeof v === 'string', 'expected string, null, or absent'),
  evolutionInfo: orNull(v => typeof v === 'string', 'expected string, null, or absent'),
  stage: whenPresent(isMemberOf(CARD_STAGES), `expected one of ${CARD_STAGES.join('/')}`),
  aceSpec: whenPresent(v => v === true, 'expected true or absent'),
  regulationMark: whenPresent(v => typeof v === 'string' && /^[A-Z]$/.test(v), 'expected single uppercase letter'),
  abilities: whenPresent(isStringArray, 'expected string[]'),
  attacks: whenPresent(isStringArray, 'expected string[]'),
  hp: whenPresent(v => isInteger(v) && v > 0, 'expected positive integer'),
  pokemonType: whenPresent(v => typeof v === 'string', 'expected string'),
  retreatCost: whenPresent(isIntegerAtLeast(0), 'expected non-negative integer'),
  rarity: whenPresent(v => typeof v === 'string', 'expected string'),
  artist: whenPresent(v => typeof v === 'string', 'expected string'),
  text: whenPresent(v => typeof v === 'string', 'expected string'),
  legality: whenPresent(
    v => isRecord(v) && Object.values(v).every(entry => typeof entry === 'string'),
    'expected Record<string, string>'
  ),
  lastUpdated: whenPresent(v => typeof v === 'string', 'expected ISO string')
};

/**
 * `mechanicSubtypes` is the one list whose bad elements are reported without an
 * index — the value itself identifies the offender better than its position
 * does, and the message is load-bearing in the card-types build logs.
 */
function validateMechanicSubtypes(value: unknown, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push('mechanicSubtypes: expected array');
    return;
  }
  for (const subtype of value) {
    if (!CARD_MECHANIC_SUBTYPES.includes(subtype as CardMechanicSubtype)) {
      errors.push(`mechanicSubtypes: unknown value "${String(subtype)}"`);
    }
  }
}

/**
 * Validate a {@link CardRecord} (a card-types.json catalog entry). Identity
 * fields (`metadataVersion`, `cardType`, `fullType`) are required; every other
 * attribute is optional but, when present, is shape- and vocabulary-checked
 * against the enums frozen in this module.
 *
 * Scalar and enum fields come from {@link CARD_RECORD_SPEC}; what remains here
 * is the handful of fields whose failure reporting is structural rather than
 * per-field (nested objects and element-indexed lists).
 * @param value the untrusted candidate
 * @returns `{ ok: true, value }` or `{ ok: false, errors }`
 */
export function validateCardRecord(value: unknown): ValidationResult<CardRecord> {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ['root: expected object'] };
  }

  checkFields(value, '', CARD_RECORD_SPEC, errors);

  if (value.mechanicSubtypes !== undefined) {
    validateMechanicSubtypes(value.mechanicSubtypes, errors);
  }
  if (value.weakness !== undefined) {
    validateWeaknessResistance(value.weakness, 'weakness', errors);
  }
  if (value.resistance !== undefined) {
    validateWeaknessResistance(value.resistance, 'resistance', errors);
  }
  if (value.abilityDetails !== undefined) {
    checkArrayOf(
      value.abilityDetails,
      'abilityDetails',
      'expected array',
      required(isAbilityDetail, 'expected {name: string, effect: string|null}'),
      errors
    );
  }
  if (value.attackDetails !== undefined) {
    checkArrayOf(
      value.attackDetails,
      'attackDetails',
      'expected array',
      required(isAttackDetail, 'expected {cost, name, damage, effect}'),
      errors
    );
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, value: value as unknown as CardRecord };
}
