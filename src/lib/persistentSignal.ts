import { createSignal, type Signal } from 'solid-js';

/**
 * Base factory for a signal that mirrors its value into `storage`. `parse`
 * turns a stored string into a value (or null to fall back); `serialize` turns
 * a value back into a string for writing.
 */
function createStoredSignal<T>(
  key: string,
  fallback: T,
  parse: (raw: string) => T | null,
  serialize: (value: T) => string,
  storage: Storage
): Signal<T> {
  let initial: T = fallback;
  try {
    const raw = storage.getItem(key);
    if (raw !== null) {
      const v = parse(raw);
      if (v !== null) {
        initial = v;
      }
    }
  } catch {
    /* storage unavailable */
  }
  const [get, set] = createSignal<T>(initial);
  const wrappedSet = ((next: T | ((prev: T) => T)) => {
    const result = set(next as Parameters<typeof set>[0]);
    try {
      storage.setItem(key, serialize(result as T));
    } catch {
      /* storage unavailable */
    }
    return result;
  }) as Signal<T>[1];
  return [get, wrappedSet];
}

export function createPersistentSignal<T extends string>(
  key: string,
  fallback: T,
  validate: (v: string) => T | null,
  storage: Storage = localStorage
): Signal<T> {
  return createStoredSignal<T>(key, fallback, validate, v => v, storage);
}

export function createPersistentViewMode(key: string) {
  return createPersistentSignal<'grid' | 'list'>(key, 'grid', v => (v === 'list' || v === 'grid' ? v : null));
}

export function createPersistentNumberSignal(
  key: string,
  fallback: number,
  storage: Storage = localStorage
): Signal<number> {
  return createStoredSignal<number>(
    key,
    fallback,
    raw => {
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    },
    n => String(n),
    storage
  );
}
