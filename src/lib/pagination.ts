import { createEffect, createMemo, createSignal, on } from 'solid-js';

export interface Pagination<T> {
  page: () => number;
  totalPages: () => number;
  pageItems: () => T[];
  setPage: (p: number) => void;
}

export function createPagination<T>(
  source: () => readonly T[],
  pageSize: number,
  resetOn: Array<() => unknown> = []
): Pagination<T> {
  const [rawPage, setRawPage] = createSignal(1);
  const totalPages = createMemo(() => Math.max(1, Math.ceil(source().length / pageSize)));
  const page = createMemo(() => Math.min(Math.max(1, rawPage()), totalPages()));
  const pageItems = createMemo(() => {
    const start = (page() - 1) * pageSize;
    return source().slice(start, start + pageSize) as T[];
  });

  for (const dep of resetOn) {
    createEffect(on(dep, () => setRawPage(1), { defer: true }));
  }

  return { page, totalPages, pageItems, setPage: setRawPage };
}
