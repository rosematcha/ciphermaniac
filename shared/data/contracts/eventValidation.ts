import { normalizeCardNumber } from '../cardIdentity';
import { validateArchetypeIdentity } from '../archetypes/identity';
import { computeSuccessTags } from './successTags';
import { parseCardIdentity, type ParsedCardUid } from './ids';
import {
  CARD_CATEGORIES,
  type EnergyType,
  MATCH_OUTCOMES,
  type MatchOutcome,
  type NormalizedEvent,
  SCHEMA_VERSION,
  type TrainerType
} from './types';
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
  orNull,
  required
} from '../validate';

const PAIR_OUTCOMES: ReadonlySet<string> = new Set<MatchOutcome>(['decided', 'tie', 'double_loss']);
const SOLO_OUTCOMES: ReadonlySet<string> = new Set<MatchOutcome>(['bye', 'unpaired', 'unknown']);
const CARD_CATEGORY_SET: ReadonlySet<string> = new Set(CARD_CATEGORIES);
const MATCH_OUTCOME_SET: ReadonlySet<string> = new Set(MATCH_OUTCOMES);
const TRAINER_TYPE_SET: ReadonlySet<string> = new Set<TrainerType>(['supporter', 'item', 'stadium', 'tool']);
const ENERGY_TYPE_SET: ReadonlySet<string> = new Set<EnergyType>(['basic', 'special']);

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

function pushDuplicate(seen: Set<string>, id: string, label: string, errors: string[]): void {
  if (seen.has(id)) {
    errors.push(`${label}: duplicate stable id "${id}"`);
  } else {
    seen.add(id);
  }
}

const NON_EMPTY_STRING_OR_NULL = orNull(isNonEmptyString, 'expected a non-empty string or null');

const NON_NEGATIVE_INTEGER_OR_NULL = orNull(isIntegerAtLeast(0), 'expected a non-negative integer or null');

const PARTICIPANT_SPEC: FieldSpec = {
  participantId: required(isNonEmptyString, 'expected non-empty string'),
  name: required(value => typeof value === 'string', 'expected string'),
  placement: orNull(isIntegerAtLeast(1), 'expected integer >= 1 or null'),
  opwPct: orNull(isFiniteInRange(0, 100), 'expected a finite number in [0, 100] or null'),
  oopwPct: orNull(isFiniteInRange(0, 100), 'expected a finite number in [0, 100] or null'),
  points: NON_NEGATIVE_INTEGER_OR_NULL,
  dropRound: orNull(isIntegerAtLeast(1), 'expected integer >= 1 or null'),
  labsDeckId: NON_EMPTY_STRING_OR_NULL,
  deckName: NON_EMPTY_STRING_OR_NULL
};

const PARTICIPANT_RECORD_SPEC: FieldSpec = {
  wins: required(isIntegerAtLeast(0), 'expected a non-negative integer'),
  losses: required(isIntegerAtLeast(0), 'expected a non-negative integer'),
  ties: required(isIntegerAtLeast(0), 'expected a non-negative integer')
};

const PARTICIPANT_FLAGS_SPEC: FieldSpec = {
  madePhase2: required(isBoolean, 'expected boolean'),
  madeTopCut: required(isBoolean, 'expected boolean'),
  dropped: required(isBoolean, 'expected boolean'),
  dqed: required(isBoolean, 'expected boolean'),
  late: required(isBoolean, 'expected boolean'),
  decklistPublished: required(isBoolean, 'expected boolean')
};

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

const DECK_SPEC: FieldSpec = {
  schemaVersion: required(value => value === SCHEMA_VERSION, `expected ${SCHEMA_VERSION}`),
  hasDecklist: required(isBoolean, 'expected boolean'),
  successTags: required(value => Array.isArray(value), 'expected array')
};

const DECK_CARD_SPEC: FieldSpec = {
  count: required(isIntegerAtLeast(1), 'expected integer >= 1'),
  category: required(isMemberOf(CARD_CATEGORY_SET), value => `invalid category "${String(value)}"`),
  aceSpec: orNull(isBoolean, 'expected boolean'),
  regulationMark: orNull(value => /^[A-Z]$/.test(String(value)), 'expected a single uppercase letter')
};

const MATCH_SPEC: FieldSpec = {
  schemaVersion: required(value => value === SCHEMA_VERSION, `expected ${SCHEMA_VERSION}`),
  outcome: required(isMemberOf(MATCH_OUTCOME_SET), value => `invalid outcome "${String(value)}"`),
  round: required(isIntegerAtLeast(1), 'expected integer >= 1'),
  phase: required(isIntegerAtLeast(1), 'expected integer >= 1'),
  table: orNull(isIntegerAtLeast(1), 'expected integer >= 1 or null'),
  completed: required(isBoolean, 'expected boolean')
};

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

function validateParticipantId(
  participant: Record<string, unknown>,
  path: string,
  ids: Set<string>,
  errors: string[]
): void {
  if (typeof participant.participantId !== 'string' || participant.participantId.length === 0) {
    errors.push(`${path}.participantId: expected non-empty string`);
  } else {
    pushDuplicate(ids, participant.participantId, path, errors);
  }
}

function validateParticipantDetails(participant: Record<string, unknown>, path: string, errors: string[]): void {
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
  const { dropRound } = participant;
  if (
    dropRound !== null &&
    dropRound !== undefined &&
    isIntegerAtLeast(1)(dropRound) &&
    (!isRecord(participant.flags) || participant.flags.dropped !== true)
  ) {
    errors.push(`${path}.dropRound: non-null dropRound requires flags.dropped to be true`);
  }
}

function validateParticipant(participant: unknown, index: number, ids: Set<string>, errors: string[]): void {
  const path = `participants[${index}]`;
  if (!isRecord(participant)) {
    errors.push(`${path}: expected object`);
    return;
  }
  validateParticipantId(participant, path, ids, errors);
  checkFields(participant, path, PARTICIPANT_SPEC, errors);
  validateParticipantDetails(participant, path, errors);
}

function validateMeta(meta: Record<string, unknown>, errors: string[]): void {
  checkFields(meta, 'root.meta', META_SPEC, errors);
}

interface ReferenceValidationContext {
  ids: Set<string>;
  participantIds: Set<string>;
  errors: string[];
}

function validateDeck(deck: unknown, index: number, context: ReferenceValidationContext): void {
  const { ids, participantIds, errors } = context;
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

function validateMatch(match: unknown, index: number, context: ReferenceValidationContext): void {
  const { ids, participantIds, errors } = context;
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

const EVENT_ROOT_SPEC: FieldSpec = {
  schemaVersion: required(value => value === SCHEMA_VERSION, `expected ${SCHEMA_VERSION}`),
  eventId: required(isNonEmptyString, 'expected non-empty string'),
  kind: required(isMemberOf(['labs-event', 'online-window']), value => `invalid kind "${String(value)}"`),
  participants: required(value => Array.isArray(value), 'expected array'),
  decks: required(value => Array.isArray(value), 'expected array'),
  matches: required(value => Array.isArray(value), 'expected array'),
  sourceRevisions: required(value => Array.isArray(value), 'expected array')
};

function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

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
    validateDeck(deck, index, { ids: deckIds, participantIds, errors });
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

function collectMatches(matches: unknown[] | null, participantIds: Set<string>, errors: string[]): void {
  if (!matches) {
    return;
  }
  const matchIds = new Set<string>();
  matches.forEach((match, index) => validateMatch(match, index, { ids: matchIds, participantIds, errors }));
  checkAscending(
    matches.map(match => (isRecord(match) && typeof match.matchId === 'string' ? match.matchId : undefined)),
    'root.matches',
    'matches',
    errors
  );
}

interface SuccessTagContext {
  participantById: Map<string, Record<string, unknown>>;
  playerCount: number | null;
  appendPhaseTags: boolean;
  errors: string[];
}

function checkSuccessTagDrift(decks: unknown[] | null, context: SuccessTagContext): void {
  const { participantById, playerCount, appendPhaseTags, errors } = context;
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
  checkSuccessTagDrift(decks, { participantById, playerCount, appendPhaseTags: kind === 'labs-event', errors });

  if (kind === 'online-window' && matches && matches.length > 0) {
    errors.push('root.matches: online windows must have an empty matches array');
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, value: value as unknown as NormalizedEvent };
}
