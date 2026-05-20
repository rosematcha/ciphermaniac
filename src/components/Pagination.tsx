import { For, Show } from 'solid-js';

interface PaginationProps {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}

/**
 * Numbered pagination (locked Pagination A).
 * Renders: ← 1 2 3 … N →
 */
export function Pagination(props: PaginationProps) {
  const pages = () => buildRange(props.page, props.totalPages);

  const goto = (p: number) => {
    const clamped = Math.min(Math.max(1, p), props.totalPages);
    if (clamped === props.page) {
      return;
    }
    props.onChange(clamped);
  };

  return (
    <nav class='pagination' aria-label='Pagination'>
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
