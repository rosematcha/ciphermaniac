/**
 * Pointer, wheel, and double-click handling for the locator map.
 *
 * One pointer drags, two pinch (zooming around their midpoint while the
 * midpoint also pans), the wheel zooms around the cursor, and a double click
 * zooms in a whole step. A mouse click that did not move becomes a pick.
 * Touch taps never pick: on a phone a tap on the map is nearly always a pan
 * that stopped short.
 * @module pages/eventLocator/mapGestures
 */

import type { LatLon } from '../../lib/events/geo';
import { fromScreen, type MapView, panBy, type Point, type Size, zoomAround } from '../../lib/events/mercator';

export interface GestureTarget {
  view: () => MapView;
  setView: (view: MapView) => void;
  size: () => Size;
  onPick: (point: LatLon) => void;
}

const CLICK_SLOP_PX = 5;
const CLICK_MS = 500;
const WHEEL_PX_PER_ZOOM = 300;

interface Press {
  x: number;
  y: number;
  time: number;
  moved: boolean;
  mouse: boolean;
  /** False when this press only dismissed the open search box. */
  pickable: boolean;
}

interface Pinch {
  distance: number;
  zoom: number;
  mid: Point;
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Controls inside the map (zoom buttons, the credit link) handle their own pointers. */
function isControl(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('button, a, input, label'));
}

type Listener = [type: string, handler: (event: never) => void, options?: AddEventListenerOptions];

/** Add listeners, and return a function that removes them. */
function listen(el: HTMLElement, listeners: Listener[]): () => void {
  for (const [type, handler, options] of listeners) {
    el.addEventListener(type, handler as EventListener, options);
  }
  return () => {
    for (const [type, handler] of listeners) {
      el.removeEventListener(type, handler as EventListener);
    }
  };
}

/** A pinch starting from the first two pointers, or null with fewer. */
function pinchFrom(pointers: Map<number, Point>, zoom: number): Pinch | null {
  const [a, b] = [...pointers.values()];
  return a && b ? { distance: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom, mid: midpoint(a, b) } : null;
}

/** The view after a pinch moves (zoom by the spread, pan by the midpoint's drift), and the new midpoint. */
function pinchStep(
  pointers: Map<number, Point>,
  pinch: Pinch,
  target: GestureTarget
): { view: MapView; mid: Point } | null {
  const [a, b] = [...pointers.values()];
  if (!a || !b) {
    return null;
  }
  const mid = midpoint(a, b);
  const zoom = pinch.zoom + Math.log2(Math.hypot(a.x - b.x, a.y - b.y) / pinch.distance);
  const zoomed = zoomAround(target.view(), target.size(), mid, zoom);
  return { view: panBy(zoomed, mid.x - pinch.mid.x, mid.y - pinch.mid.y), mid };
}

/** A pointer position relative to the map element. */
function localPoint(el: HTMLElement, e: { clientX: number; clientY: number }): Point {
  const box = el.getBoundingClientRect();
  return { x: e.clientX - box.left, y: e.clientY - box.top };
}

/** True while the search box is open: a press on the map then only dismisses it. */
function isDismissingSearch(): boolean {
  return Boolean(document.querySelector('.el-search.open'));
}

/**
 * Wire gestures onto the map element.
 * @returns A function that removes every listener
 */
export function attachGestures(el: HTMLElement, target: GestureTarget): () => void {
  const pointers = new Map<number, Point>();
  let press: Press | null = null;
  let pinch: Pinch | null = null;

  const local = (e: { clientX: number; clientY: number }) => localPoint(el, e);

  const startPinch = () => {
    pinch = pinchFrom(pointers, target.view().zoom) ?? pinch;
  };

  const movePinch = () => {
    const step = pinch && pinchStep(pointers, pinch, target);
    if (pinch && step) {
      target.setView(step.view);
      pinch = { ...pinch, mid: step.mid };
    }
  };

  const onDown = (e: PointerEvent) => {
    if (isControl(e.target) || (e.pointerType === 'mouse' && e.button !== 0)) {
      return;
    }
    el.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, local(e));
    if (pointers.size === 1) {
      press = {
        ...local(e),
        time: e.timeStamp,
        moved: false,
        mouse: e.pointerType === 'mouse',
        pickable: !isDismissingSearch()
      };
      return;
    }
    if (press) {
      press.moved = true;
    }
    startPinch();
  };

  const onMove = (e: PointerEvent) => {
    const previous = pointers.get(e.pointerId);
    if (!previous) {
      return;
    }
    const point = local(e);
    pointers.set(e.pointerId, point);
    if (pointers.size > 1) {
      movePinch();
      return;
    }
    target.setView(panBy(target.view(), point.x - previous.x, point.y - previous.y));
    if (press && Math.hypot(point.x - press.x, point.y - press.y) > CLICK_SLOP_PX) {
      press.moved = true;
    }
  };

  const onUp = (e: PointerEvent) => {
    if (!pointers.delete(e.pointerId)) {
      return;
    }
    if (pointers.size === 1) {
      pinch = null;
    }
    const tap =
      press &&
      !press.moved &&
      press.mouse &&
      press.pickable &&
      e.type === 'pointerup' &&
      e.timeStamp - press.time < CLICK_MS;
    if (pointers.size === 0 && tap) {
      target.onPick(fromScreen(local(e), target.view(), target.size()));
    }
    if (pointers.size === 0) {
      press = null;
      pinch = null;
    }
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    const view = target.view();
    const step = Math.max(-1, Math.min(1, delta / WHEEL_PX_PER_ZOOM));
    target.setView(zoomAround(view, target.size(), local(e), view.zoom - step));
  };

  const onDouble = (e: MouseEvent) => {
    if (isControl(e.target)) {
      return;
    }
    const view = target.view();
    target.setView(zoomAround(view, target.size(), local(e), Math.floor(view.zoom) + 1));
  };

  return listen(el, [
    ['pointerdown', onDown],
    ['pointermove', onMove],
    ['pointerup', onUp],
    ['pointercancel', onUp],
    ['wheel', onWheel, { passive: false }],
    ['dblclick', onDouble]
  ]);
}
