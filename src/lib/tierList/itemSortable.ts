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
 *
 * The board is rendered by a framework that owns those nodes, so the drag puts
 * every node back exactly where it found it before reporting the drop. Leaving
 * a node reparented makes the next render duplicate it: the framework rebuilds
 * the destination from state and the hand-moved node is still sitting there.
 * State is the only authority; this module just proposes a move.
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
  /** Where the item sat before the drag, so it can be handed back untouched. */
  home: { parent: Node; next: Node | null };
}

/** Where a completed drag wants its item to end up. */
export interface ItemDrop {
  itemId: string;
  /** A tier id, or `tray`. */
  zone: string;
  /** Index among that zone's items. */
  index: number;
}

export interface ItemSortableOptions {
  /** Apply the move to state; the caller re-renders and this module animates the settle. */
  onDrop: (drop: ItemDrop) => void;
}

const rectOf = (el: Element): DOMRect => el.getBoundingClientRect();

/** Put a tile back where it was found, tolerating a sibling that has since moved. */
function restore(item: HTMLElement, home: { parent: Node; next: Node | null }): void {
  const next = home.next?.parentNode === home.parent ? home.next : null;
  home.parent.insertBefore(item, next);
}

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

    // Captured before anything moves: the node that follows the tile in its
    // own zone. Taking it after the placeholder is inserted would capture the
    // tile itself, and handing a node back in front of itself throws.
    state.home = { parent: state.item.parentNode!, next: state.item.nextSibling };

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
      over: null,
      home: { parent: document.body, next: null }
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

  /** Index the placeholder currently sits at, among its zone's real tiles. */
  function dropIndex(placeholder: HTMLElement): number {
    let index = 0;
    for (const child of placeholder.parentNode?.children ?? []) {
      if (child === placeholder) {
        break;
      }
      if (child.classList.contains('tl-item')) {
        index += 1;
      }
    }
    return index;
  }

  /**
   * Slide the freshly-rendered tile from wherever the pointer left it. The
   * element that lands is not the element that was dragged — the framework
   * built a new one — so the settle is anchored to a remembered rect rather
   * than to the node.
   */
  function settle(itemId: string, from: DOMRect): void {
    requestAnimationFrame(() => {
      const landed = document.querySelector<HTMLElement>(`.tl-item[data-id="${CSS.escape(itemId)}"]`);
      if (!landed) {
        return;
      }
      const to = rectOf(landed);
      const dx = from.left - to.left;
      const dy = from.top - to.top;
      if (!dx && !dy) {
        return;
      }
      landed.style.transition = 'none';
      landed.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      requestAnimationFrame(() => {
        landed.style.transition = '';
        landed.style.transform = '';
      });
    });
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
    const { item, placeholder, over, home } = drag;
    const from = rectOf(item);
    const zone = placeholder!.parentNode as HTMLElement | null;
    const target = zone?.dataset.tier;
    const index = dropIndex(placeholder!);
    const itemId = item.dataset.id ?? '';

    // Hand every node back exactly as it was found, then let state decide.
    placeholder!.remove();
    item.style.width = '';
    item.style.height = '';
    item.style.transform = '';
    item.classList.remove('tl-dragging');
    over?.classList.remove('over');
    document.body.classList.remove('tl-drag-active');
    restore(item, home);

    drag = null;
    if (target && itemId) {
      options.onDrop({ itemId, zone: target, index });
      settle(itemId, from);
    }
  }

  function onPointerCancel(): void {
    if (drag?.started) {
      drag.placeholder?.remove();
      drag.item.style.width = '';
      drag.item.style.height = '';
      drag.item.style.transform = '';
      drag.item.classList.remove('tl-dragging');
      document.body.classList.remove('tl-drag-active');
      restore(drag.item, drag.home);
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
