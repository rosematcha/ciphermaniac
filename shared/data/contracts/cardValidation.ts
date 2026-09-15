import {
  CARD_CATEGORIES,
  CARD_MECHANIC_SUBTYPES,
  CARD_STAGES,
  type CardMechanicSubtype,
  type CardRecord
} from './types';
import type { ValidationResult } from './eventValidation';
import {
  checkArrayOf,
  checkFields,
  type FieldSpec,
  isInteger,
  isIntegerAtLeast,
  isMemberOf,
  isNonEmptyString,
  isRecord,
  isStringArray,
  orNull,
  required,
  whenPresent
} from '../validate';

const WEAKNESS_RESISTANCE_SPEC: FieldSpec = {
  type: required(isNonEmptyString, 'expected non-empty string'),
  modifier: required(v => v === null || typeof v === 'string', 'expected string or null')
};

function validateWeaknessResistance(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path}: expected object`);
    return;
  }
  checkFields(value, path, WEAKNESS_RESISTANCE_SPEC, errors);
}

function isAbilityDetail(value: unknown): boolean {
  return (
    isRecord(value) && typeof value.name === 'string' && (value.effect === null || typeof value.effect === 'string')
  );
}

function isAttackDetail(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    (value.cost === null || typeof value.cost === 'string') &&
    (value.damage === null || typeof value.damage === 'string') &&
    (value.effect === null || typeof value.effect === 'string')
  );
}

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
