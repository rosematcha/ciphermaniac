/**
 * Declarative field validation for the normalized and serving layers.
 *
 * The validators in `contracts.ts` and `artifacts.ts` were built from ~185
 * hand-written `if (typeof x !== 'y') { errors.push(...) }` chains. Each one is
 * trivial alone, but stacked they gave single functions cyclomatic complexities
 * in the 40-55 range with no structure left to read them by — the shape of the
 * record being validated was buried in control flow.
 *
 * A field check is really two things: a predicate, and the message tail it
 * emits when the predicate fails. Expressing that pair as data ({@link
 * FieldRule}) lets a validator body become a table of field -> rule, with
 * {@link checkFields} as the only branch. What stays hand-written is what
 * genuinely is not a field check: cross-field invariants, referential
 * resolution, ordering, and dedupe.
 *
 * Message tails are written verbatim at each spec site rather than generated
 * from the predicate. They are the validators' public surface — a pipeline
 * failure is read out of a log by a human, and the contract tests match on
 * their text — so they are worth stating explicitly and keeping stable.
 *
 * IMPORTANT: like the modules it serves, this one is environment-neutral
 * (browser + Node + Workers) and must stay dependency-free.
 * @module shared/data/validate
 */

// ============================================================================
// Shared predicates
// ============================================================================

/** A plain object — excludes `null` and arrays, both of which are `typeof 'object'`. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A number that is an exact integer (rejects NaN, Infinity and fractions). */
export function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

/** A boolean. Named for symmetry with the other predicates, so specs read as a table. */
export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

/** A string with at least one character. */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** An array whose every element is a string. Empty arrays pass. */
export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(entry => typeof entry === 'string');
}

/** An integer greater than or equal to `min`. */
export function isIntegerAtLeast(min: number): (value: unknown) => boolean {
  return value => isInteger(value) && value >= min;
}

/** A finite number within the inclusive range `[low, high]`. */
export function isFiniteInRange(low: number, high: number): (value: unknown) => boolean {
  return value => typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high;
}

/** A member of `allowed`. Non-string values fail rather than throwing. */
export function isMemberOf(allowed: ReadonlySet<string> | readonly string[]): (value: unknown) => boolean {
  const set = Array.isArray(allowed) ? new Set<string>(allowed) : (allowed as ReadonlySet<string>);
  return value => typeof value === 'string' && set.has(value);
}

// ============================================================================
// Rules
// ============================================================================

/**
 * How a rule treats an absent value.
 * - `'required'`: every value is checked, including `undefined` and `null`.
 * - `'absent'`: `undefined` passes; an explicit `null` is still checked.
 * - `'nullish'`: both `undefined` and `null` pass.
 */
export type Presence = 'required' | 'absent' | 'nullish';

/**
 * A predicate paired with the message tail it emits on failure.
 *
 * `expected` may be a function of the rejected value. Several of these
 * validators name the offending value back to the reader ("invalid outcome
 * \"foo\""), which is the difference between a log line you can act on and one
 * you have to go re-run the pipeline to understand — so the rule carries the
 * formatting rather than forcing those fields back into hand-written branches.
 */
export interface FieldRule {
  readonly ok: (value: unknown) => boolean;
  readonly expected: string | ((value: unknown) => string);
  readonly presence: Presence;
}

/** A table of field name -> rule describing one object shape. */
export type FieldSpec = Readonly<Record<string, FieldRule>>;

/** A rule that every value must satisfy. */
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

/** Resolve a rule's message tail against the value that failed it. */
function messageFor(rule: FieldRule, value: unknown): string {
  return typeof rule.expected === 'function' ? rule.expected(value) : rule.expected;
}

/** True when `presence` says this value is exempt from its rule. */
function skips(value: unknown, presence: Presence): boolean {
  if (presence === 'required') {
    return false;
  }
  if (value === undefined) {
    return true;
  }
  return presence === 'nullish' && value === null;
}

// ============================================================================
// Runner
// ============================================================================

/**
 * Check every field in `spec` against `record`, appending one message per
 * failure to `errors`.
 *
 * Messages are `${path}.${field}: ${rule.expected}`, or `${field}: …` when
 * `path` is empty (the card catalog reports unprefixed field names). Checks are
 * independent: every field is tested and every failure is collected, matching
 * the layer's existing "never stop at the first error" behaviour.
 * @param record the object under validation
 * @param path dotted path to `record`, or `''` for a root-level record
 * @param spec field rules to apply
 * @param errors accumulator appended to in place
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

/**
 * Check every element of `value` against `element`, reporting the array itself
 * when it is not an array at all.
 *
 * The two failure modes read differently to whoever is debugging the pipeline —
 * "this was not a list" versus "item 3 of this list was wrong" — so they get
 * separate messages, indexed by position.
 * @param value the candidate array
 * @param path dotted path to the array
 * @param arrayExpected message tail when `value` is not an array
 * @param element rule applied to each element
 * @param errors accumulator appended to in place
 */
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
