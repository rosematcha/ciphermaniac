import { createSignal, type Signal } from 'solid-js';

export function createPersistentSignal<T extends string>(
  key: string,
  fallback: T,
  validate: (v: string) => T | null
): Signal<T> {
  let initial: T = fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null) {
      const v = validate(raw);
      if (v !== null) {
        initial = v;
      }
    }
  } catch {
    /* localStorage unavailable */
  }
  const [get, set] = createSignal<T>(initial);
  const wrappedSet = ((next: T | ((prev: T) => T)) => {
    const result = set(next as Parameters<typeof set>[0]);
    try {
      localStorage.setItem(key, result as string);
    } catch {
      /* localStorage unavailable */
    }
    return result;
  }) as Signal<T>[1];
  return [get, wrappedSet];
}

export function createPersistentViewMode(key: string) {
  return createPersistentSignal<'grid' | 'list'>(key, 'grid', v => (v === 'list' || v === 'grid' ? v : null));
}
