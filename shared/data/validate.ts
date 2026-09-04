/** Dependency-free field validation shared by browser, Node, and Workers. */

/** A plain object — excludes `null` and arrays, both of which are `typeof 'object'`. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(entry => typeof entry === 'string');
}

export function isIntegerAtLeast(min: number): (value: unknown) => boolean {
  return value => isInteger(value) && value >= min;
}

export function isFiniteInRange(low: number, high: number): (value: unknown) => boolean {
  return value => typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high;
}

export function isMemberOf(allowed: ReadonlySet<string> | readonly string[]): (value: unknown) => boolean {
  const set = Array.isArray(allowed) ? new Set<string>(allowed) : (allowed as ReadonlySet<string>);
  return value => typeof value === 'string' && set.has(value);
}

/**
 * How a rule treats an absent value.
 * - `'required'`: every value is checked, including `undefined` and `null`.
 * - `'absent'`: `undefined` passes; an explicit `null` is still checked.
 * - `'nullish'`: both `undefined` and `null` pass.
 */
export type Presence = 'required' | 'absent' | 'nullish';

/** A predicate paired with its stable error-message tail. */
export interface FieldRule {
  readonly ok: (value: unknown) => boolean;
  readonly expected: string | ((value: unknown) => string);
  readonly presence: Presence;
}

export type FieldSpec = Readonly<Record<string, FieldRule>>;

export function required(ok: (value: unknown) => boolean, expected: FieldRule['expected']): FieldRule {
  return { ok, expected, presence: 'required' };
}

/**
 * A rule checked only when the field is present. An explicit `null` is still
 * checked — use {@link orNull} for fields where `null` is a legal value.
 */
export function whenPresent(ok: (value: unknown) => boolean, expected: FieldRule['expected']): FieldRule {
  return { ok, expected, presence: 'absent' };
}

/** A rule checked only when the field is neither `undefined` nor `null`. */
export function orNull(ok: (value: unknown) => boolean, expected: FieldRule['expected']): FieldRule {
  return { ok, expected, presence: 'nullish' };
}

function messageFor(rule: FieldRule, value: unknown): string {
  return typeof rule.expected === 'function' ? rule.expected(value) : rule.expected;
}

function skips(value: unknown, presence: Presence): boolean {
  if (presence === 'required') {
    return false;
  }
  if (value === undefined) {
    return true;
  }
  return presence === 'nullish' && value === null;
}

/**
 * Appends every field failure as `${path}.${field}: ${expected}`. An empty path
 * omits the leading dot.
 */
export function checkFields(record: Record<string, unknown>, path: string, spec: FieldSpec, errors: string[]): void {
  const prefix = path ? `${path}.` : '';
  for (const field of Object.keys(spec)) {
    const rule = spec[field];
    const value = record[field];
    if (skips(value, rule.presence)) {
      continue;
    }
    if (!rule.ok(value)) {
      errors.push(`${prefix}${field}: ${messageFor(rule, value)}`);
    }
  }
}

/** Reports a non-array at `path`, or invalid elements at their indexes. */
export function checkArrayOf(
  value: unknown,
  path: string,
  arrayExpected: string,
  element: FieldRule,
  errors: string[]
): void {
  if (!Array.isArray(value)) {
    errors.push(`${path}: ${arrayExpected}`);
    return;
  }
  value.forEach((entry, index) => {
    if (!element.ok(entry)) {
      errors.push(`${path}[${index}]: ${messageFor(element, entry)}`);
    }
  });
}
