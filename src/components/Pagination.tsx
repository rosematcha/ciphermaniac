import { For, Show } from 'solid-js';
import '../styles/pages/players-tables.css';

interface PaginationProps {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
  /** Rows per page. Provide with `totalItems` to render a "Showing X–Y of Z" summary. */
  pageSize?: number;
  /** Total row count across all pages. Provide with `pageSize` to render the summary. */
  totalItems?: number;
}

/**
 * Numbered pagination (locked Pagination A).
 * Renders: ← 1 2 3 … N →
 * When `pageSize` and `totalItems` are both supplied, also renders a
 * "Showing 1–50 of 944" summary alongside the controls.
 */
export function Pagination(props: PaginationProps) {
  const pages = () => buildRange(props.page, props.totalPages);
  let navEl: HTMLElement | undefined;

  const goto = (p: number) => {
    const clamped = Math.min(Math.max(1, p), props.totalPages);
    if (clamped === props.page) {
      return;
    }
    props.onChange(clamped);
    // The controls sit below the list, so after a page swap the viewport
    // would still be pinned at the bottom — showing the new page's LAST rows.
    // Jump back to the top of the containing section.
    navEl?.parentElement?.scrollIntoView({ block: 'start' });
  };

  const summary = () => {
    const size = props.pageSize;
    const total = props.totalItems;
    if (size == null || total == null) {
      return null;
    }
    if (total === 0) {
      return 'No results';
    }
    const start = (props.page - 1) * size + 1;
    const end = Math.min(props.page * size, total);
    return `Showing ${start.toLocaleString()}–${end.toLocaleString()} of ${total.toLocaleString()}`;
  };

  return (
    <nav ref={navEl} class='pagination' aria-label='Pagination'>
      <Show when={summary()}>
        <span class='pagination-summary'>{summary()}</span>
      </Show>
      <button type='button' onClick={() => goto(props.page - 1)} aria-label='Previous page' disabled={props.page <= 1}>
        ←
      </button>
      <For each={pages()}>
        {p => (
          <Show when={p !== 'ellipsis'} fallback={<span class='ellipsis'>…</span>}>
            <button
              type='button'
              class={p === props.page ? 'active' : ''}
              onClick={() => goto(p as number)}
              aria-current={p === props.page ? 'page' : undefined}
            >
              {p}
            </button>
          </Show>
        )}
      </For>
      <button
        type='button'
        onClick={() => goto(props.page + 1)}
        aria-label='Next page'
        disabled={props.page >= props.totalPages}
      >
        →
      </button>
    </nav>
  );
}

function buildRange(current: number, total: number): (number | 'ellipsis')[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const out: (number | 'ellipsis')[] = [];
  const push = (v: number | 'ellipsis') => out.push(v);

  push(1);
  if (current > 4) {
    push('ellipsis');
  }
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  for (let i = start; i <= end; i++) {
    push(i);
  }
  if (current < total - 3) {
    push('ellipsis');
  }
  push(total);
  return out;
}
