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

import { canonicalizeVariant, normalizeCardNumber } from '../cardUtils';
import { archetypeKey, archetypeSlug } from './archetypes/identity';

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
  const parsed = parseCardUid(uid);
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
  if (!isInteger(card.count) || card.count < 1) {
    errors.push(`${path}.count: expected integer >= 1`);
  }
  const { category } = card;
  if (!CARD_CATEGORY_SET.has(category as string)) {
    errors.push(`${path}.category: invalid category "${String(category)}"`);
  }
  const { trainerType, energyType, aceSpec, regulationMark } = card;
  if (trainerType !== null && trainerType !== undefined) {
    if (category !== 'trainer') {
      errors.push(`${path}.trainerType: only allowed when category is "trainer"`);
    } else if (!TRAINER_TYPE_SET.has(trainerType as string)) {
      errors.push(`${path}.trainerType: invalid trainer type "${String(trainerType)}"`);
    }
  }
  if (energyType !== null && energyType !== undefined) {
    if (category !== 'energy') {
      errors.push(`${path}.energyType: only allowed when category is "energy"`);
    } else if (!ENERGY_TYPE_SET.has(energyType as string)) {
      errors.push(`${path}.energyType: invalid energy type "${String(energyType)}"`);
    }
  }
  if (aceSpec !== null && aceSpec !== undefined && typeof aceSpec !== 'boolean') {
    errors.push(`${path}.aceSpec: expected boolean`);
  }
  if (regulationMark !== null && regulationMark !== undefined && !/^[A-Z]$/.test(String(regulationMark))) {
    errors.push(`${path}.regulationMark: expected a single uppercase letter`);
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
  } else {
    for (const field of ['wins', 'losses', 'ties'] as const) {
      const value = participant.record[field];
      if (!isInteger(value) || value < 0) {
        errors.push(`${path}.record.${field}: expected a non-negative integer`);
      }
    }
  }
  if (!isRecord(participant.flags)) {
    errors.push(`${path}.flags: expected object`);
  } else {
    for (const flag of ['madePhase2', 'madeTopCut', 'dropped', 'dqed', 'late', 'decklistPublished'] as const) {
      if (typeof participant.flags[flag] !== 'boolean') {
        errors.push(`${path}.flags.${flag}: expected boolean`);
      }
    }
  }
  for (const field of ['opwPct', 'oopwPct'] as const) {
    const value = participant[field];
    if (value !== null && value !== undefined) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
        errors.push(`${path}.${field}: expected a finite number in [0, 100] or null`);
      }
    }
  }
  // Labs source fields — all optional; validated only when present (online
  // windows omit them entirely).
  const { points } = participant;
  if (points !== null && points !== undefined && (!isInteger(points) || points < 0)) {
    errors.push(`${path}.points: expected a non-negative integer or null`);
  }
  const { icons } = participant;
  if (icons !== null && icons !== undefined) {
    if (!Array.isArray(icons)) {
      errors.push(`${path}.icons: expected an array of non-empty strings`);
    } else {
      icons.forEach((icon, iconIndex) => {
        if (typeof icon !== 'string' || icon.length === 0) {
          errors.push(`${path}.icons[${iconIndex}]: expected a non-empty string`);
        }
      });
    }
  }
  const { dropRound } = participant;
  if (dropRound !== null && dropRound !== undefined) {
    if (!isInteger(dropRound) || dropRound < 1) {
      errors.push(`${path}.dropRound: expected integer >= 1 or null`);
    } else if (!isRecord(participant.flags) || participant.flags.dropped !== true) {
      // Cross-check: a drop round is only meaningful for a dropped participant.
      errors.push(`${path}.dropRound: non-null dropRound requires flags.dropped to be true`);
    }
  }
  for (const field of ['labsDeckId', 'deckName'] as const) {
    const value = participant[field];
    if (value !== null && value !== undefined && (typeof value !== 'string' || value.length === 0)) {
      errors.push(`${path}.${field}: expected a non-empty string or null`);
    }
  }
}

function validateMeta(meta: Record<string, unknown>, errors: string[]): void {
  const path = 'root.meta';
  if (!isInteger(meta.playerCount) || meta.playerCount < 0) {
    errors.push(`${path}.playerCount: expected integer >= 0`);
  }
  // Optional Labs string fields — non-empty string or null when present.
  for (const field of [
    'country',
    'city',
    'eventType',
    'updatedAt',
    'rk9Id',
    'playlatamId',
    'labsCode',
    'sourceTournamentId'
  ] as const) {
    const value = meta[field];
    if (value !== null && value !== undefined && (typeof value !== 'string' || value.length === 0)) {
      errors.push(`${path}.${field}: expected a non-empty string or null`);
    }
  }
  for (const field of ['completed', 'started'] as const) {
    const value = meta[field];
    if (value !== null && value !== undefined && typeof value !== 'boolean') {
      errors.push(`${path}.${field}: expected boolean or null`);
    }
  }
  for (const field of ['playersRound1', 'decklistCount'] as const) {
    const value = meta[field];
    if (value !== null && value !== undefined && (!isInteger(value) || value < 0)) {
      errors.push(`${path}.${field}: expected a non-negative integer or null`);
    }
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
  const { outcome } = match;
  if (!MATCH_OUTCOME_SET.has(outcome as string)) {
    errors.push(`${path}.outcome: invalid outcome "${String(outcome)}"`);
  }
  if (!isInteger(match.round) || match.round < 1) {
    errors.push(`${path}.round: expected integer >= 1`);
  }
  if (!isInteger(match.phase) || match.phase < 1) {
    errors.push(`${path}.phase: expected integer >= 1`);
  }
  if (match.table !== null && match.table !== undefined && (!isInteger(match.table) || match.table < 1)) {
    errors.push(`${path}.table: expected integer >= 1 or null`);
  }
  if (typeof match.completed !== 'boolean') {
    errors.push(`${path}.completed: expected boolean`);
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
    // Cross-validate arity against outcome: solo outcomes name one participant,
    // pair outcomes name two.
    if (SOLO_OUTCOMES.has(outcome as string) && memberIds.length !== 1) {
      errors.push(`${path}.participantIds: outcome "${String(outcome)}" requires exactly 1 participant`);
    }
    if (PAIR_OUTCOMES.has(outcome as string) && memberIds.length !== 2) {
      errors.push(`${path}.participantIds: outcome "${String(outcome)}" requires exactly 2 participants`);
    }
  }
  const winner = match.winnerParticipantId;
  const hasWinner = winner !== null && winner !== undefined;
  if (hasWinner) {
    if (typeof winner !== 'string' || !participantIds.has(winner)) {
      errors.push(`${path}.winnerParticipantId: unresolved participant "${String(winner)}"`);
    } else if (Array.isArray(memberIds) && !memberIds.includes(winner)) {
      errors.push(`${path}.winnerParticipantId: winner "${winner}" is not a match participant`);
    }
  }
  // winnerParticipantId is REQUIRED for 'decided' and FORBIDDEN for every other
  // outcome.
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
  } else {
    validateMeta(value.meta, errors);
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
  const participantById = new Map<string, Record<string, unknown>>();
  if (participants) {
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
  }

  const deckIds = new Set<string>();
  const deckById = new Map<string, Record<string, unknown>>();
  const deckByParticipant = new Map<string, number>();
  if (decks) {
    decks.forEach((deck, index) => {
      validateDeck(deck, index, deckIds, participantIds, errors);
      if (isRecord(deck) && typeof deck.deckId === 'string') {
        deckById.set(deck.deckId, deck);
        if (typeof deck.participantId === 'string') {
          if (deckByParticipant.has(deck.participantId)) {
            errors.push(
              `decks[${index}].participantId: participant "${deck.participantId}" is claimed by more than one deck`
            );
          } else {
            deckByParticipant.set(deck.participantId, index);
          }
        }
      }
    });
    checkAscending(
      decks.map(deck => (isRecord(deck) && typeof deck.deckId === 'string' ? deck.deckId : undefined)),
      'root.decks',
      'decks',
      errors
    );
  }

  // Participant.deckId must resolve to a deck AND the referenced deck must
  // point back at that same participant (deck↔participant reconciliation).
  if (participants) {
    participants.forEach((participant, index) => {
      if (isRecord(participant)) {
        const ref = participant.deckId;
        if (ref !== null && ref !== undefined) {
          if (typeof ref !== 'string' || !deckIds.has(ref)) {
            errors.push(`participants[${index}].deckId: unresolved deck "${String(ref)}"`);
          } else {
            const deck = deckById.get(ref);
            if (deck && deck.participantId !== participant.participantId) {
              errors.push(
                `participants[${index}].deckId: deck "${ref}" back-references participant "${String(deck.participantId)}", not "${String(participant.participantId)}"`
              );
            }
          }
        }
      }
    });
  }

  const matchIds = new Set<string>();
  if (matches) {
    matches.forEach((match, index) => validateMatch(match, index, matchIds, participantIds, errors));
    checkAscending(
      matches.map(match => (isRecord(match) && typeof match.matchId === 'string' ? match.matchId : undefined)),
      'root.matches',
      'matches',
      errors
    );
  }

  if (Array.isArray(value.sourceRevisions)) {
    checkAscending(
      value.sourceRevisions.map(revision =>
        isRecord(revision) && typeof revision.source === 'string' && typeof revision.entityId === 'string'
          ? `${revision.source}\u0000${revision.entityId}`
          : undefined
      ),
      'root.sourceRevisions',
      'sourceRevisions',
      errors
    );
  }

  // successTags must equal the policy recomputation exactly (order included, for
  // byte-determinism). Phase tags append only for Labs events (D7 divergence).
  const playerCount = isRecord(value.meta) && isInteger(value.meta.playerCount) ? value.meta.playerCount : null;
  if (decks) {
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
        appendPhaseTags: kind === 'labs-event'
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

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(v => typeof v === 'string');
}

/** Validate a structured Weakness/Resistance ({type: string, modifier: string|null}). */
function validateWeaknessResistance(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path}: expected object`);
    return;
  }
  if (typeof value.type !== 'string' || value.type.length === 0) {
    errors.push(`${path}.type: expected non-empty string`);
  }
  if (value.modifier !== null && typeof value.modifier !== 'string') {
    errors.push(`${path}.modifier: expected string or null`);
  }
}

/**
 * Validate a {@link CardRecord} (a card-types.json catalog entry). Identity
 * fields (`metadataVersion`, `cardType`, `fullType`) are required; every other
 * attribute is optional but, when present, is shape- and vocabulary-checked
 * against the enums frozen in this module.
 * @param value the untrusted candidate
 * @returns `{ ok: true, value }` or `{ ok: false, errors }`
 */
export function validateCardRecord(value: unknown): ValidationResult<CardRecord> {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ['root: expected object'] };
  }

  if (!isInteger(value.metadataVersion) || value.metadataVersion < 1) {
    errors.push('metadataVersion: expected positive integer');
  }
  if (typeof value.cardType !== 'string' || !CARD_CATEGORIES.includes(value.cardType as CardCategory)) {
    errors.push(`cardType: expected one of ${CARD_CATEGORIES.join('/')}`);
  }
  if (typeof value.fullType !== 'string' || value.fullType.length === 0) {
    errors.push('fullType: expected non-empty string');
  }

  if (value.subType !== undefined && value.subType !== null && typeof value.subType !== 'string') {
    errors.push('subType: expected string, null, or absent');
  }
  if (value.evolutionInfo !== undefined && value.evolutionInfo !== null && typeof value.evolutionInfo !== 'string') {
    errors.push('evolutionInfo: expected string, null, or absent');
  }
  if (value.stage !== undefined && !CARD_STAGES.includes(value.stage as CardStage)) {
    errors.push(`stage: expected one of ${CARD_STAGES.join('/')}`);
  }
  if (value.mechanicSubtypes !== undefined) {
    if (!Array.isArray(value.mechanicSubtypes)) {
      errors.push('mechanicSubtypes: expected array');
    } else {
      for (const m of value.mechanicSubtypes) {
        if (!CARD_MECHANIC_SUBTYPES.includes(m as CardMechanicSubtype)) {
          errors.push(`mechanicSubtypes: unknown value "${String(m)}"`);
        }
      }
    }
  }
  if (value.aceSpec !== undefined && value.aceSpec !== true) {
    errors.push('aceSpec: expected true or absent');
  }
  if (
    value.regulationMark !== undefined &&
    (typeof value.regulationMark !== 'string' || !/^[A-Z]$/.test(value.regulationMark))
  ) {
    errors.push('regulationMark: expected single uppercase letter');
  }
  if (value.abilities !== undefined && !isStringArray(value.abilities)) {
    errors.push('abilities: expected string[]');
  }
  if (value.attacks !== undefined && !isStringArray(value.attacks)) {
    errors.push('attacks: expected string[]');
  }
  if (value.hp !== undefined && (!isInteger(value.hp) || value.hp <= 0)) {
    errors.push('hp: expected positive integer');
  }
  if (value.pokemonType !== undefined && typeof value.pokemonType !== 'string') {
    errors.push('pokemonType: expected string');
  }
  if (value.weakness !== undefined) {
    validateWeaknessResistance(value.weakness, 'weakness', errors);
  }
  if (value.resistance !== undefined) {
    validateWeaknessResistance(value.resistance, 'resistance', errors);
  }
  if (value.retreatCost !== undefined && (!isInteger(value.retreatCost) || value.retreatCost < 0)) {
    errors.push('retreatCost: expected non-negative integer');
  }
  if (value.rarity !== undefined && typeof value.rarity !== 'string') {
    errors.push('rarity: expected string');
  }
  if (value.artist !== undefined && typeof value.artist !== 'string') {
    errors.push('artist: expected string');
  }
  if (value.text !== undefined && typeof value.text !== 'string') {
    errors.push('text: expected string');
  }
  if (value.abilityDetails !== undefined) {
    if (!Array.isArray(value.abilityDetails)) {
      errors.push('abilityDetails: expected array');
    } else {
      value.abilityDetails.forEach((a, i) => {
        if (!isRecord(a) || typeof a.name !== 'string' || (a.effect !== null && typeof a.effect !== 'string')) {
          errors.push(`abilityDetails[${i}]: expected {name: string, effect: string|null}`);
        }
      });
    }
  }
  if (value.attackDetails !== undefined) {
    if (!Array.isArray(value.attackDetails)) {
      errors.push('attackDetails: expected array');
    } else {
      value.attackDetails.forEach((a, i) => {
        if (
          !isRecord(a) ||
          typeof a.name !== 'string' ||
          (a.cost !== null && typeof a.cost !== 'string') ||
          (a.damage !== null && typeof a.damage !== 'string') ||
          (a.effect !== null && typeof a.effect !== 'string')
        ) {
          errors.push(`attackDetails[${i}]: expected {cost, name, damage, effect}`);
        }
      });
    }
  }
  if (value.legality !== undefined) {
    if (!isRecord(value.legality) || !Object.values(value.legality).every(v => typeof v === 'string')) {
      errors.push('legality: expected Record<string, string>');
    }
  }
  if (value.lastUpdated !== undefined && typeof value.lastUpdated !== 'string') {
    errors.push('lastUpdated: expected ISO string');
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, value: value as unknown as CardRecord };
}
