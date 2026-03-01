/**
 * Grid scroll restoration — preserves scroll position across page navigations.
 * Saves scrollY to sessionStorage before leaving, restores when returning.
 */

const STORAGE_KEY = 'grid_scroll_y';

/** Save current scroll position (call before navigating away from grid). */
export function saveGridScroll(): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, String(window.scrollY));
  } catch {
    // Storage may be unavailable
  }
}

/** Restore saved scroll position and clear it. Returns true if restored. */
export function restoreGridScroll(): boolean {
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved !== null) {
      const y = Number(saved);
      sessionStorage.removeItem(STORAGE_KEY);
      if (Number.isFinite(y) && y > 0) {
        // Defer to allow DOM to render rows first
        requestAnimationFrame(() => {
          window.scrollTo(0, y);
        });
        return true;
      }
    }
  } catch {
    // Ignore
  }
  return false;
}
