import { updateLayout } from './layout.js';
import { getGridElement } from './elements.js';

const MOBILE_SAFARI_REGEX = /^((?!chrome|android).)*safari/i;
const IS_SAFARI = typeof navigator !== 'undefined' && MOBILE_SAFARI_REGEX.test(navigator.userAgent);
const RESIZE_THROTTLE_MS = IS_SAFARI ? 150 : 50;

function throttle<T extends (...args: Parameters<T>) => void>(fn: T, wait: number): T {
  let lastCall = 0;
  let scheduledCall: ReturnType<typeof setTimeout> | null = null;

  return ((...args: Parameters<T>) => {
    const now = Date.now();
    const timeSinceLastCall = now - lastCall;

    if (scheduledCall) {
      clearTimeout(scheduledCall);
      scheduledCall = null;
    }

    if (timeSinceLastCall >= wait) {
      lastCall = now;
      fn(...args);
    } else {
      scheduledCall = setTimeout(() => {
        lastCall = Date.now();
        fn(...args);
        scheduledCall = null;
      }, wait - timeSinceLastCall);
    }
  }) as T;
}

let throttledUpdateLayout: (() => void) | null = null;

/**
 * Initialize a ResizeObserver for the grid container.
 */
export function initGridResizeObserver(): void {
  const grid = getGridElement();
  if (!grid || grid._resizeObserver) {
    return;
  }

  if (!throttledUpdateLayout) {
    throttledUpdateLayout = throttle(() => {
      updateLayout();
    }, RESIZE_THROTTLE_MS);
  }

  const observer = new ResizeObserver(entries => {
    for (const entry of entries) {
      const newWidth = entry.contentRect.width;
      const lastWidth = grid._lastContainerWidth ?? 0;

      if (Math.abs(newWidth - lastWidth) > 1) {
        grid._lastContainerWidth = newWidth;
        throttledUpdateLayout?.();
      }
    }
  });

  observer.observe(grid);
  grid._resizeObserver = observer;
}

/**
 * Disconnect the grid ResizeObserver.
 */
export function cleanupGridResizeObserver(): void {
  const grid = getGridElement();
  if (grid?._resizeObserver) {
    grid._resizeObserver.disconnect();
    grid._resizeObserver = null;
  }
}
