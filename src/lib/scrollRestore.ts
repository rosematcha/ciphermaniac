import { createEffect, on, onCleanup } from 'solid-js';
import { useBeforeLeave, useLocation } from '@solidjs/router';

/**
 * Scroll restoration for history traversals (P-perf plan, P1).
 *
 * The router scrolls to top on forward navigations but leaves back/forward
 * at the top too, so the core browse flow — scroll deep into /cards, open a
 * card, hit Back — lost the user's place. We take over from the browser
 * (`scrollRestoration = 'manual'`; its native restore fires before the SPA
 * has re-rendered the list and clamps to the skeleton's height) and restore
 * ourselves, retrying briefly while the page grows back to its former height.
 *
 * Positions are keyed by pathname+search and mirrored to sessionStorage so a
 * reload restores too. An explicit user scroll cancels a pending restore.
 */

const STORAGE_KEY = 'cm:scroll-positions';
const MAX_ENTRIES = 50;
const RESTORE_DEADLINE_MS = 1500;

// Registered at module scope, NOT inside the component: the Router installs
// its own popstate handler when it's created, and handlers on the same target
// run in registration order. This module is imported (and the listener
// attached) before render() creates the Router, so the traversal flag is
// already set by the time the router's handler updates the location signal —
// which is what fires the restore effect below.
let traversal = false;
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    traversal = true;
  });
}

function loadSaved(): Map<string, number> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? new Map(JSON.parse(raw) as [string, number][]) : new Map();
  } catch {
    return new Map();
  }
}

function persist(saved: Map<string, number>): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...saved]));
  } catch {
    /* quota/private-mode failures just lose reload restore */
  }
}

export function useScrollRestoration(): void {
  if (typeof window === 'undefined') {
    return;
  }
  history.scrollRestoration = 'manual';

  const saved = loadSaved();
  const location = useLocation();
  const locationKey = () => location.pathname + location.search;

  const save = (key: string) => {
    saved.delete(key); // re-insert so Map stays LRU-ordered
    saved.set(key, window.scrollY);
    while (saved.size > MAX_ENTRIES) {
      saved.delete(saved.keys().next().value as string);
    }
    persist(saved);
  };

  // Covers router-driven leaves (both pushes and pops). pagehide catches the
  // leaves the router never sees: reload and tab close.
  useBeforeLeave(() => save(locationKey()));
  const onPageHide = () => save(locationKey());
  window.addEventListener('pagehide', onPageHide);
  onCleanup(() => window.removeEventListener('pagehide', onPageHide));

  let cancelRestore: (() => void) | undefined;

  const restore = (target: number) => {
    cancelRestore?.();
    const started = performance.now();
    let raf = 0;
    const cancel = () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('wheel', cancel);
      window.removeEventListener('touchmove', cancel);
      window.removeEventListener('keydown', cancel);
      cancelRestore = undefined;
    };
    const attempt = () => {
      // Keep asserting the target for the whole window rather than stopping
      // at first success: the router's own scroll-to-top lands asynchronously
      // after the traversal and would undo a one-shot restore, and pages
      // render skeletons first so the document may still be growing toward
      // the saved offset.
      if (Math.abs(window.scrollY - target) > 1) {
        window.scrollTo(0, target);
      }
      if (performance.now() - started > RESTORE_DEADLINE_MS) {
        cancel();
        return;
      }
      raf = requestAnimationFrame(attempt);
    };
    window.addEventListener('wheel', cancel, { passive: true });
    window.addEventListener('touchmove', cancel, { passive: true });
    window.addEventListener('keydown', cancel);
    cancelRestore = cancel;
    raf = requestAnimationFrame(attempt);
  };

  createEffect(
    on(locationKey, key => {
      if (traversal) {
        traversal = false;
        const target = saved.get(key);
        if (target != null) {
          restore(target);
          return;
        }
      }
      cancelRestore?.();
    })
  );

  // Reload: the router never navigates, so the traversal effect above won't
  // fire. Restore the position saved by pagehide for this same URL.
  const initial = saved.get(locationKey());
  if (initial != null) {
    restore(initial);
  }
}
