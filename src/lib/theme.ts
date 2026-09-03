/**
 * Light and dark mode.
 *
 * The mode lives on `body[data-mode]` and every colour follows from the tokens
 * that attribute selects, so switching is one attribute write rather than a
 * re-render. `initTheme` runs before the first render (main.tsx) — after it,
 * only the footer toggle writes.
 *
 * With nothing stored the site follows the OS, and keeps following it for the
 * session: someone whose machine goes dark at sunset gets a dark site without
 * having asked twice. Picking a mode ends that — an explicit choice outranks
 * the system, which is why the listener re-reads storage rather than trusting a
 * flag captured at startup.
 * @module lib/theme
 */

import { createSignal } from 'solid-js';

export type Mode = 'light' | 'dark';

const STORAGE_KEY = 'cm:mode';
const DARK_QUERY = '(prefers-color-scheme: dark)';
/** Keeps the browser's own chrome (mobile address bar) on the page's side. */
const THEME_COLOR: Record<Mode, string> = { light: '#f4ecdb', dark: '#1a1816' };

/** The mode the user has explicitly chosen, if any. */
function storedMode(): Mode | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === 'light' || saved === 'dark' ? saved : null;
  } catch {
    // Storage can be unavailable (private mode, blocked cookies); the site
    // still themes, it just cannot remember.
    return null;
  }
}

function systemMode(): Mode {
  return typeof matchMedia === 'function' && matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

const [mode, setModeSignal] = createSignal<Mode>(storedMode() ?? systemMode());

/** The mode in effect. Reactive — read it to render a control's state. */
export { mode };

function paint(next: Mode): void {
  document.body.dataset.mode = next;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[next]);
}

/** Puts the mode on the document. Call once, before the first render. */
export function initTheme(): void {
  paint(mode());
  if (typeof matchMedia !== 'function') {
    return;
  }
  matchMedia(DARK_QUERY).addEventListener('change', event => {
    if (storedMode()) {
      return;
    }
    setModeSignal(event.matches ? 'dark' : 'light');
    paint(mode());
  });
}

/** Records a deliberate choice, which the OS no longer overrides. */
export function setMode(next: Mode): void {
  setModeSignal(next);
  paint(next);
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* the choice holds for this page, just not the next one */
  }
}
