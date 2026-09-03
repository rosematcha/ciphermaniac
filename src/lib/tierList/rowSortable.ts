/**
 * Dragging a tier by its move buttons.
 *
 * The buttons stay single-step on click. Hold and move, and the row itself
 * comes with the pointer — the same gesture as dragging a tile, so there is one
 * way to reorder things on this page rather than two.
 *
 * Rows are never lifted out of flow. Everything is a transform: the held row
 * follows the pointer, and the rows it displaces slide by exactly the height it
 * vacated. Row heights differ (a tier holding six tiles wraps to two lines), so
 * positions are recomputed from a running sum each frame rather than assuming a
 * single row-height step.
 * @module lib/tierList/rowSortable
 */

/** Pointer travel before a press on a move button becomes a drag. */
const THRESHOLD = 4;
/** How long the held row takes to settle into the slot it earned. */
const SETTLE_MS = 140;

interface RowDrag {
  button: HTMLElement;
  startY: number;
  dy: number;
  started: boolean;
  raf: number;
  rows: HTMLElement[];
  heights: number[];
  tops: number[];
  held: number;
  order: number[];
  resting: number;
}

export interface RowSortableOptions {
  /** Receives the tier ids in the order the user settled on. */
  onReorder: (ids: string[]) => void;
}

/**
 * Installs the row sortable on the document. Returns a teardown for `onCleanup`.
 * @param options - Callbacks. `onReorder` fires once per completed drag.
 * @returns Function removing every listener it installed.
 */
export function installRowSortable(options: RowSortableOptions): () => void {
  let drag: RowDrag | null = null;
  let suppressClick = false;

  /** Where the held row's centre sits right now, in viewport coordinates. */
  const heldCentre = (state: RowDrag): number => state.tops[state.held]! + state.heights[state.held]! / 2 + state.dy;

  /** Re-derive the visual order by asking where the held row's centre falls. */
  function reorder(state: RowDrag): void {
    const others = state.order.filter(i => i !== state.held);
    const centre = heldCentre(state);
    let y = state.tops[0]!;
    let at = others.length;
    for (let k = 0; k < others.length; k++) {
      const rowCentre = y + state.heights[others[k]!]! / 2;
      y += state.heights[others[k]!]!;
      if (centre < rowCentre) {
        at = k;
        break;
      }
    }
    state.order = [...others.slice(0, at), state.held, ...others.slice(at)];
  }

  /** Slide every displaced row to its new slot; remember where the held one lands. */
  function layout(state: RowDrag): void {
    let y = state.tops[0]!;
    for (const i of state.order) {
      if (i === state.held) {
        state.resting = y - state.tops[i]!;
      } else {
        state.rows[i]!.style.transform = `translateY(${y - state.tops[i]!}px)`;
      }
      y += state.heights[i]!;
    }
  }

  function frame(): void {
    if (!drag?.started) {
      return;
    }
    drag.raf = 0;
    reorder(drag);
    layout(drag);
    drag.rows[drag.held]!.style.transform = `translateY(${drag.dy}px)`;
  }

  function schedule(): void {
    if (drag && !drag.raf) {
      drag.raf = requestAnimationFrame(frame);
    }
  }

  function begin(state: RowDrag): boolean {
    const row = state.button.closest<HTMLElement>('.tl-row');
    const board = row?.closest('.tl-board');
    if (!row || !board) {
      return false;
    }
    state.rows = [...board.querySelectorAll<HTMLElement>('.tl-row[data-row]')];
    const rects = state.rows.map(el => el.getBoundingClientRect());
    state.heights = rects.map(r => r.height);
    state.tops = rects.map(r => r.top);
    state.held = state.rows.indexOf(row);
    state.order = state.rows.map((_, i) => i);
    if (state.held < 0) {
      return false;
    }
    state.started = true;
    for (const el of state.rows) {
      el.style.transition = 'none';
    }
    row.classList.add('tl-row-held');
    document.body.classList.add('tl-rowdrag');
    return true;
  }

  function onPointerDown(event: PointerEvent): void {
    const target = event.target as Element | null;
    const button = target?.closest<HTMLElement>('[data-move]');
    if (!button || event.button > 0) {
      return;
    }
    drag = {
      button,
      startY: event.clientY,
      dy: 0,
      started: false,
      raf: 0,
      rows: [],
      heights: [],
      tops: [],
      held: -1,
      order: [],
      resting: 0
    };
    button.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event: PointerEvent): void {
    if (!drag) {
      return;
    }
    drag.dy = event.clientY - drag.startY;
    if (!drag.started) {
      if (Math.abs(drag.dy) < THRESHOLD) {
        return;
      }
      if (!begin(drag)) {
        drag = null;
        return;
      }
      schedule();
      return;
    }
    event.preventDefault();
    schedule();
  }

  function finish(state: RowDrag): void {
    const ids = state.order.map(i => state.rows[i]!.dataset.row ?? '');
    const settled = state.resting === state.dy;
    const held = state.rows[state.held]!;

    held.style.transition = `transform ${SETTLE_MS}ms var(--ease-base)`;
    held.style.transform = `translateY(${state.resting}px)`;
    held.classList.remove('tl-row-held');
    document.body.classList.remove('tl-rowdrag');

    const done = (): void => {
      for (const el of state.rows) {
        el.style.transition = '';
        el.style.transform = '';
      }
      options.onReorder(ids);
    };
    if (settled) {
      done();
    } else {
      setTimeout(done, SETTLE_MS);
    }
  }

  function onPointerUp(): void {
    if (!drag) {
      return;
    }
    if (!drag.started) {
      drag = null;
      return;
    }
    if (drag.raf) {
      cancelAnimationFrame(drag.raf);
    }
    // A click fires after the pointer sequence; a drag is not a click.
    suppressClick = true;
    setTimeout(() => {
      suppressClick = false;
    }, 0);
    finish(drag);
    drag = null;
  }

  function onClick(event: MouseEvent): void {
    const target = event.target as Element | null;
    if (suppressClick && target?.closest('[data-move]')) {
      event.stopPropagation();
      event.preventDefault();
    }
  }

  function onPointerCancel(): void {
    if (drag?.started) {
      for (const el of drag.rows) {
        el.style.transition = '';
        el.style.transform = '';
      }
      drag.rows[drag.held]?.classList.remove('tl-row-held');
      document.body.classList.remove('tl-rowdrag');
    }
    drag = null;
  }

  document.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('pointermove', onPointerMove, { passive: false });
  document.addEventListener('pointerup', onPointerUp);
  document.addEventListener('pointercancel', onPointerCancel);
  document.addEventListener('click', onClick, true);

  return () => {
    document.removeEventListener('pointerdown', onPointerDown);
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
    document.removeEventListener('pointercancel', onPointerCancel);
    document.removeEventListener('click', onClick, true);
  };
}
