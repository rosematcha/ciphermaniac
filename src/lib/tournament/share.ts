/**
 * Keeping what did not change. Every poll and every answer hands the pages a
 * whole new copy of the event, and a list drawn from it keeps a row only
 * while the row's object is the same one: a new copy made every table and
 * every player a new row, rebuilt from nothing, whatever had changed. So a
 * new copy is laid over the one shown, and each part that says the same as
 * before is the old part again. One result in a round of 250 tables is then
 * one new row.
 */

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Lists pair up by position: results change a match in place, and new players and rounds join at the end. */
function sharedList(before: readonly unknown[], after: readonly unknown[]): readonly unknown[] {
  let items: unknown[] | undefined;
  for (let i = 0; i < after.length; i += 1) {
    const item = shared(before[i], after[i]);
    if (!items && (i >= before.length || item !== before[i])) {
      items = before.slice(0, i);
    }
    items?.push(item);
  }
  return items ?? (after.length === before.length ? before : before.slice(0, after.length));
}

function setSharedValue(r: Json, key: string, value: unknown): void {
  if (key === '__proto__') {
    Object.defineProperty(r, key, { value, enumerable: true, configurable: true, writable: true });
  } else {
    r[key] = value;
  }
}

/** A changed record keeps `after`'s key order, as the server sent it. */
function sharedRecord(before: Json, after: Json): Json {
  const keys = Object.keys(after);
  const values = keys.map(key => shared(before[key], after[key]));
  const same =
    keys.length === Object.keys(before).length &&
    keys.every((key, i) => Object.hasOwn(before, key) && values[i] === before[key]);
  if (same) {
    return before;
  }
  const result: Json = {};
  keys.forEach((key, i) => setSharedValue(result, key, values[i]));
  return result;
}

/** `after`, with every part that says what its counterpart in `before` said being that counterpart. */
export function shared<T>(before: unknown, after: T): T {
  if (before === after) {
    return after;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    return sharedList(before, after) as T;
  }
  if (isRecord(before) && isRecord(after)) {
    return sharedRecord(before, after) as T;
  }
  return after;
}
