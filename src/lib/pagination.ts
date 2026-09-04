import { createEffect, createMemo, createSignal, on, type Signal } from 'solid-js';

export interface Pagination<T> {
  page: () => number;
  totalPages: () => number;
  pageItems: () => T[];
  setPage: (p: number) => void;
}

export function createQueryPageSignal(
  read: () => string | undefined,
  write: (value: string | undefined) => void
): Signal<number> {
  const get = () => {
    const value = Number(read());
    return Number.isInteger(value) && value > 1 ? value : 1;
  };
  const set: Signal<number>[1] = value => {
    const next = typeof value === 'function' ? value(get()) : value;
    write(next > 1 ? String(next) : undefined);
    return next;
  };
  return [get, set];
}

export function createPagination<T>(
  source: () => readonly T[],
  pageSize: number,
  resetOn?: Array<() => unknown>,
  pageSignal?: Signal<number>
): Pagination<T> {
  // eslint-disable-next-line solid/reactivity -- signal tuple, not a reactive read; the `??` just confuses the analyzer
  const [rawPage, setRawPage] = pageSignal ?? createSignal(1);
  const totalPages = createMemo(() => Math.max(1, Math.ceil(source().length / pageSize)));
  const page = createMemo(() => Math.min(Math.max(1, rawPage()), totalPages()));
  const pageItems = createMemo(() => {
    const start = (page() - 1) * pageSize;
    return source().slice(start, start + pageSize) as T[];
  });

  if (resetOn && resetOn.length > 0) {
    createEffect(on(resetOn, () => setRawPage(1), { defer: true }));
  }

  return { page, totalPages, pageItems, setPage: setRawPage };
}
