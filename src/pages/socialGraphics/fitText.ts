/**
 * Shrink-to-fit for the social-graphics canvas.
 *
 * Card names on the canvas are single-line by design — the layout is a fixed
 * 1280px composition and a wrapped name would push the hero body into the
 * image above it. Long names ("Team Rocket's Factory", "Area Zero
 * Underdepths") used to either spill outside the card or get ellipsized into
 * uselessness, so instead we scale the type down until the name fits its box.
 * @module src/pages/socialGraphics/fitText
 */

import { createEffect, onCleanup } from 'solid-js';

/** Type-size bounds for one shrink-to-fit slot, in px. */
export interface FitBounds {
  /** Design size — used whenever the name already fits. */
  max: number;
  /** Floor; below this the name ellipsizes rather than shrinking further. */
  min: number;
}

/**
 * The font size that makes `needed` px of text fit `avail` px of box.
 *
 * Text width is very close to linear in font size, so one proportional step
 * lands within a pixel; the caller re-measures and nudges down from there.
 * @param bounds Size bounds for the slot.
 * @param avail Available box width in px.
 * @param needed Rendered text width in px at `bounds.max`.
 * @returns The size to try, clamped to the bounds.
 */
export function fitFontSize(bounds: FitBounds, avail: number, needed: number): number {
  if (needed <= avail || needed <= 0 || avail <= 0) {
    return bounds.max;
  }
  const scaled = Math.floor((bounds.max * avail) / needed);
  return Math.min(bounds.max, Math.max(bounds.min, scaled));
}

/**
 * The measurable surface of a single-line text box.
 *
 * Structural rather than an `HTMLElement` so the fit loop can be exercised
 * without a browser — layout is the only thing it needs from the DOM.
 */
export interface FitTarget {
  /** Width of the box the text has to fit in, in px. */
  readonly clientWidth: number;
  /** Width of the text as currently sized, in px. */
  readonly scrollWidth: number;
  /** Apply a candidate font size, in px. */
  setFontSize: (px: number) => void;
}

/**
 * Size a single-line text box down until its text fits, or the floor is hit.
 * @param target The box to size.
 * @param bounds Size bounds for the slot.
 * @returns The applied font size in px.
 */
export function fitToWidth(target: FitTarget, bounds: FitBounds): number {
  target.setFontSize(bounds.max);
  let size = fitFontSize(bounds, target.clientWidth, target.scrollWidth);
  target.setFontSize(size);
  // Sub-pixel metrics and hinting can leave the proportional step a hair wide;
  // walk it down, bounded by the floor.
  while (size > bounds.min && target.scrollWidth > target.clientWidth) {
    size -= 1;
    target.setFontSize(size);
  }
  return size;
}

/** Fonts must be loaded before a measurement means anything. */
function fontsReady(): Promise<unknown> {
  return typeof document !== 'undefined' && 'fonts' in document ? document.fonts.ready : Promise.resolve(null);
}

/**
 * Bind an element's font size to whatever fits its box on one line.
 *
 * Call from a `ref` callback so it runs inside the owning reactive scope;
 * `text` is tracked, so the fit recomputes whenever the name changes.
 * @param el The single-line text element (must clip its overflow).
 * @param text Reactive accessor for the rendered text.
 * @param bounds Size bounds for the slot.
 */
export function fitText(el: HTMLElement, text: () => string, bounds: FitBounds): void {
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });

  const measure = (): void => {
    if (disposed || !el.isConnected) {
      return;
    }
    fitToWidth(
      {
        get clientWidth() {
          return el.clientWidth;
        },
        get scrollWidth() {
          return el.scrollWidth;
        },
        setFontSize: px => {
          el.style.fontSize = `${px}px`;
        }
      },
      bounds
    );
  };

  createEffect(() => {
    text();
    measure();
    void fontsReady().then(measure);
  });
}
