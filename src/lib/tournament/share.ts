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
  const items = after.map((item, i) => shared(before[i], item));
  return items.length === before.length && items.every((item, i) => item === before[i]) ? before : items;
}

function sharedRecord(before: Json, after: Json): Json {
  const keys = Object.keys(after);
  const entries = keys.map(key => [key, shared(before[key], after[key])] as const);
  const same = keys.length === Object.keys(before).length && entries.every(([key, value]) => value === before[key]);
  return same ? before : Object.fromEntries(entries);
}

/** `after`, with every part that says what its counterpart in `before` said being that counterpart. */
export function shared<T>(before: unknown, after: T): T {
  if (Array.isArray(before) && Array.isArray(after)) {
    return sharedList(before, after) as T;
  }
  if (isRecord(before) && isRecord(after)) {
    return sharedRecord(before, after) as T;
  }
  return after;
}
