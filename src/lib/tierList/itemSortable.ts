/**
 * Dragging tiles between tiers.
 *
 * Pointer Events, not HTML5 drag-and-drop: HTML5 DnD does not fire on touch at
 * all, and this has to work on a phone. Four things make it feel like direct
 * manipulation rather than a form control:
 *
 * 1. A real placeholder. Tiles part to make room where the drop will land,
 *    instead of the dragged tile teleporting to the end of a row on release.
 * 2. FLIP. When the placeholder moves, every affected tile is snapped back to
 *    where it was and released, so the reflow reads as motion rather than as a
 *    jump. Transforms only — layout is never animated.
 * 3. One rAF per frame. Pointer moves are recorded and coalesced; nothing
 *    touches the DOM outside the frame, and zone rects are measured once at
 *    drag start rather than hit-tested on every move.
 * 4. The dragged element itself is what moves. A clone can drift out of sync
 *    with the original.
 * @module lib/tierList/itemSortable
 */

/** Pointer travel before a press becomes a drag. */
const THRESHOLD = 4;
/** Distance from the viewport edge at which the page starts scrolling. */
const EDGE = 72;
/** Scroll speed at the very edge, in px per frame. */
const EDGE_SPEED = 18;

interface ZoneRect {
  el: HTMLElement;
  rect: DOMRect;
}

interface DragState {
  item: HTMLElement;
  startX: number;
  startY: number;
  x: number;
  y: number;
  started: boolean;
  raf: number;
  grabX: number;
  grabY: number;
  placeholder: HTMLElement | null;
  zones: ZoneRect[];
  over: HTMLElement | null;
}

/** Reports a completed move so the caller can read the DOM back into state. */
export interface ItemSortableOptions {
  onDrop: () => void;
}

const rectOf = (el: Element): DOMRect => el.getBoundingClientRect();

/**
 * Installs the sortable on the document. Returns a teardown for `onCleanup`.
 * @param options - Callbacks. `onDrop` fires once per completed move.
 * @returns Function removing every listener it installed.
 */
export function installItemSortable(options: ItemSortableOptions): () => void {
  let drag: DragState | null = null;

  function snapshot(): Map<HTMLElement, DOMRect> {
    const map = new Map<HTMLElement, DOMRect>();
    for (const el of document.querySelectorAll<HTMLElement>('.tl-item')) {
      map.set(el, rectOf(el));
    }
    return map;
  }

  /** "Last, invert, play": transform each moved tile back, then release it. */
  function flip(first: Map<HTMLElement, DOMRect>): void {
    for (const [el, before] of first) {
      if (el === drag?.item) {
        continue;
      }
      const after = rectOf(el);
      const dx = before.left - after.left;
      const dy = before.top - after.top;
      if (!dx && !dy) {
        continue;
      }
      el.style.transition = 'none';
      el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
    }
    requestAnimationFrame(() => {
      for (const el of first.keys()) {
        if (el === drag?.item) {
          continue;
        }
        el.style.transition = '';
        el.style.transform = '';
      }
    });
  }

  function begin(state: DragState): void {
    const rect = rectOf(state.item);
    state.started = true;
    state.grabX = state.startX - rect.left;
    state.grabY = state.startY - rect.top;

    const placeholder = document.createElement('div');
    placeholder.className = 'tl-slot';
    placeholder.style.width = `${rect.width}px`;
    placeholder.style.height = `${rect.height}px`;
    state.item.parentNode?.insertBefore(placeholder, state.item);
    state.placeholder = placeholder;

    state.item.style.width = `${rect.width}px`;
    state.item.style.height = `${rect.height}px`;
    state.item.classList.add('tl-dragging');
    document.body.appendChild(state.item);
    document.body.classList.add('tl-drag-active');

    state.zones = [...document.querySelectorAll<HTMLElement>('.tl-zone')].map(el => ({ el, rect: rectOf(el) }));
  }

  /** Where in `zone` a pointer at (x, y) should insert, as an index among its tiles. */
  function insertionIndex(zone: HTMLElement, x: number, y: number): number {
    const tiles = [...zone.children].filter(
      (c): c is HTMLElement => c !== drag?.placeholder && c.classList.contains('tl-item')
    );
    let best = tiles.length;
    let bestDistance = Infinity;
    tiles.forEach((el, i) => {
      const rect = rectOf(el);
      // Row-aware: prefer the wrapped row the pointer is actually in, then the
      // nearer horizontal edge within it.
      const rowPenalty = y < rect.top ? (rect.top - y) * 4 : y > rect.bottom ? (y - rect.bottom) * 4 : 0;
      for (const [edge, index] of [
        [rect.left, i],
        [rect.right, i + 1]
      ] as const) {
        const distance = Math.abs(x - edge) + rowPenalty;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = index;
        }
      }
    });
    return best;
  }

  function remeasure(state: DragState): void {
    for (const zone of state.zones) {
      zone.rect = rectOf(zone.el);
    }
  }

  function autoScroll(state: DragState): void {
    const fromTop = state.y - EDGE;
    const fromBottom = window.innerHeight - EDGE - state.y;
    let by = 0;
    if (fromTop < 0) {
      by = -EDGE_SPEED * Math.min(1, -fromTop / EDGE);
    } else if (fromBottom < 0) {
      by = EDGE_SPEED * Math.min(1, -fromBottom / EDGE);
    }
    if (!by) {
      return;
    }
    window.scrollBy(0, by);
    remeasure(state);
    schedule();
  }

  function movePlaceholder(state: DragState, zone: HTMLElement): void {
    const index = insertionIndex(zone, state.x, state.y);
    const children = [...zone.children].filter(c => c.classList.contains('tl-item') || c === state.placeholder);
    if (state.placeholder!.parentNode === zone && children.indexOf(state.placeholder!) === index) {
      return;
    }
    const first = snapshot();
    const before = [...zone.children].filter(c => c !== state.placeholder && c.classList.contains('tl-item'))[index];
    zone.insertBefore(state.placeholder!, before ?? null);
    flip(first);
    remeasure(state);
  }

  function frame(): void {
    if (!drag?.started) {
      return;
    }
    const state = drag;
    state.raf = 0;
    state.item.style.transform = `translate3d(${state.x - state.grabX}px, ${state.y - state.grabY}px, 0)`;

    const hit = state.zones.find(
      z => state.x >= z.rect.left && state.x <= z.rect.right && state.y >= z.rect.top && state.y <= z.rect.bottom
    );
    const zone = hit?.el ?? null;
    if (zone !== state.over) {
      state.over?.classList.remove('over');
      zone?.classList.add('over');
      state.over = zone;
    }
    if (zone) {
      movePlaceholder(state, zone);
    }
    autoScroll(state);
  }

  function schedule(): void {
    if (drag && !drag.raf) {
      drag.raf = requestAnimationFrame(frame);
    }
  }

  function onPointerDown(event: PointerEvent): void {
    const target = event.target as Element | null;
    const item = target?.closest<HTMLElement>('.tl-item');
    if (!item || event.button > 0) {
      return;
    }
    // Regrabbing mid-settle would measure the tile's animating box, not its
    // resting one, and the next drag would start displaced by however far the
    // settle had left to run. The regrab IS the interruption.
    if (item.style.transform) {
      item.style.transition = 'none';
      item.style.transform = '';
      void item.offsetWidth;
      item.style.transition = '';
    }
    drag = {
      item,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      started: false,
      raf: 0,
      grabX: 0,
      grabY: 0,
      placeholder: null,
      zones: [],
      over: null
    };
    item.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event: PointerEvent): void {
    if (!drag) {
      return;
    }
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (!drag.started) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < THRESHOLD) {
        return;
      }
      begin(drag);
      schedule();
      return;
    }
    event.preventDefault();
    schedule();
  }

  function onPointerUp(): void {
    if (!drag) {
      return;
    }
    if (drag.raf) {
      cancelAnimationFrame(drag.raf);
    }
    if (!drag.started) {
      drag = null;
      return;
    }
    const { item, placeholder, over } = drag;
    const from = rectOf(item);
    const to = rectOf(placeholder!);

    // Hand the tile back to the document flow first, then animate the gap it
    // has to close, so the settle always lands exactly on the layout.
    placeholder!.parentNode?.insertBefore(item, placeholder!);
    placeholder!.remove();
    item.style.width = '';
    item.style.height = '';
    item.classList.remove('tl-dragging');
    over?.classList.remove('over');
    document.body.classList.remove('tl-drag-active');

    item.style.transition = 'none';
    item.style.transform = `translate3d(${from.left - to.left}px, ${from.top - to.top}px, 0)`;
    requestAnimationFrame(() => {
      item.style.transition = '';
      item.style.transform = '';
    });

    for (const zone of document.querySelectorAll('.tl-zone')) {
      zone.classList.toggle('empty', !zone.querySelector('.tl-item'));
    }
    drag = null;
    options.onDrop();
  }

  function onPointerCancel(): void {
    if (drag?.started) {
      drag.placeholder?.parentNode?.insertBefore(drag.item, drag.placeholder);
      drag.placeholder?.remove();
      drag.item.style.width = '';
      drag.item.style.height = '';
      drag.item.style.transform = '';
      drag.item.classList.remove('tl-dragging');
      document.body.classList.remove('tl-drag-active');
    }
    drag = null;
  }

  document.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('pointermove', onPointerMove, { passive: false });
  document.addEventListener('pointerup', onPointerUp);
  document.addEventListener('pointercancel', onPointerCancel);

  return () => {
    document.removeEventListener('pointerdown', onPointerDown);
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
    document.removeEventListener('pointercancel', onPointerCancel);
  };
}
