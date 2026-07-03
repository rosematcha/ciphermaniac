import { createSignal, type Signal } from 'solid-js';

export function createPersistentSignal<T extends string>(
  key: string,
  fallback: T,
  validate: (v: string) => T | null,
  storage: Storage = localStorage
): Signal<T> {
  let initial: T = fallback;
  try {
    const raw = storage.getItem(key);
    if (raw !== null) {
      const v = validate(raw);
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
      storage.setItem(key, result as string);
    } catch {
      /* storage unavailable */
    }
    return result;
  }) as Signal<T>[1];
  return [get, wrappedSet];
}

export function createPersistentViewMode(key: string) {
  return createPersistentSignal<'grid' | 'list'>(key, 'grid', v => (v === 'list' || v === 'grid' ? v : null));
}

export function createPersistentNumberSignal(
  key: string,
  fallback: number,
  storage: Storage = localStorage
): Signal<number> {
  let initial = fallback;
  try {
    const raw = storage.getItem(key);
    if (raw !== null) {
      const n = Number(raw);
      if (Number.isFinite(n)) {
        initial = n;
      }
    }
  } catch {
    /* storage unavailable */
  }
  const [get, set] = createSignal<number>(initial);
  const wrappedSet = ((next: number | ((prev: number) => number)) => {
    const result = set(next as Parameters<typeof set>[0]);
    try {
      storage.setItem(key, String(result));
    } catch {
      /* storage unavailable */
    }
    return result;
  }) as Signal<number>[1];
  return [get, wrappedSet];
}
