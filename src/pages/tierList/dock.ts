/**
 * The phone dock's four heights.
 *
 * Bar tucks the pile away and leaves the header and actions, so the whole board
 * is on screen. Short is the resting height: two rows of the pile. Half and
 * tall are for reading the pile. The handle drags the dock to any height and
 * settles it on the nearest stop when let go; a tap raises it one stop, and
 * from the top drops it back to short.
 * @module pages/tierList/dock
 */

import { type Accessor, createSignal } from 'solid-js';

const STOPS = ['bar', 'short', 'half', 'tall'] as const;
type DockStop = (typeof STOPS)[number];

/** Viewport units rather than pixels, so the stops follow the screen. */
const STOP_CSS: Record<Exclude<DockStop, 'bar'>, string> = { short: '176px', half: '48vh', tall: '80vh' };
/** The topnav stays in reach above the tallest drag. */
const TOP_CLEARANCE = 64;
/** Less movement than this is a tap. */
const SLOP = 6;

interface Dock {
  ref: (el: HTMLDivElement) => void;
  height: Accessor<string>;
  dragging: Accessor<boolean>;
  raised: Accessor<boolean>;
  grip: {
    onPointerDown: (event: PointerEvent) => void;
    onPointerMove: (event: PointerEvent) => void;
    onPointerUp: () => void;
    onPointerCancel: () => void;
    onClick: () => void;
  };
}

export function useDock(): Dock {
  const [stop, setStop] = createSignal<DockStop>('short');
  const [drag, setDrag] = createSignal<number | null>(null);
  let tray: HTMLDivElement | undefined;
  let start: { y: number; height: number } | null = null;
  let dragged = false;

  // The bar is the dock down to the top of its pile.
  const barHeight = (): number => tray?.querySelector<HTMLElement>(':scope > .tl-zone')?.offsetTop ?? 0;
  const pixels = (): Record<DockStop, number> => ({
    bar: barHeight(),
    short: 176,
    half: window.innerHeight * 0.48,
    tall: window.innerHeight * 0.8
  });

  const height = (): string => {
    const px = drag();
    if (px !== null) {
      return `${px}px`;
    }
    const current = stop();
    return current === 'bar' ? `${barHeight()}px` : STOP_CSS[current];
  };

  function settle(): void {
    const px = drag();
    const heights = pixels();
    if (px !== null) {
      setStop(STOPS.reduce((best, s) => (Math.abs(heights[s] - px) < Math.abs(heights[best] - px) ? s : best)));
    }
    setDrag(null);
    start = null;
  }

  return {
    ref: el => (tray = el),
    height,
    dragging: () => drag() !== null,
    raised: () => stop() === 'half' || stop() === 'tall',
    grip: {
      onPointerDown: event => {
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        start = { y: event.clientY, height: tray?.getBoundingClientRect().height ?? 0 };
        dragged = false;
      },
      onPointerMove: event => {
        const dy = start ? event.clientY - start.y : 0;
        if (!start || (!dragged && Math.abs(dy) < SLOP)) {
          return;
        }
        dragged = true;
        setDrag(Math.max(barHeight(), Math.min(window.innerHeight - TOP_CLEARANCE, start.height - dy)));
      },
      onPointerUp: settle,
      onPointerCancel: settle,
      // A drag ends in a click on the handle too; only a tap steps.
      onClick: () => {
        if (!dragged) {
          setStop(current => STOPS[STOPS.indexOf(current) + 1] ?? 'short');
        }
        dragged = false;
      }
    }
  };
}
