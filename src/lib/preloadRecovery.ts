/**
 * Recovery for lazy-route chunks that a deploy has removed.
 *
 * Every route below the home page is code-split, so a tab left open across a
 * deploy still holds the previous shell — and that shell points at
 * content-hashed chunks the server no longer has. The next navigation then
 * fails inside Vite's preload helper ("Unable to preload CSS for
 * /assets/<Page>-<hash>.css") and the route never renders. Pages makes the
 * failure quieter and stranger than a plain 404: with no top-level 404.html it
 * answers a missing asset with the HTML shell, so the stylesheet request comes
 * back 200 with the wrong type.
 *
 * Vite dispatches a cancelable `vite:preloadError` before throwing, which is
 * the hook: reload once and the tab picks up the current shell.
 * @module src/lib/preloadRecovery
 */

/** How long a reload suppresses the next one. */
export const RELOAD_GUARD_MS = 30_000;

const RELOAD_GUARD_KEY = 'cm:preload-reload';

/**
 * Whether a preload failure should reload the page.
 *
 * One reload fixes a stale shell. A second one straight after means the asset
 * is genuinely gone — reloading again would just spin, so let the error throw
 * and surface instead.
 * @param lastReloadAt Epoch ms of the last recovery reload, or null if none.
 * @param now Current epoch ms.
 * @returns True when a reload is worth attempting.
 */
export function shouldReloadAfterPreloadError(lastReloadAt: number | null, now: number): boolean {
  if (lastReloadAt === null || !Number.isFinite(lastReloadAt)) {
    return true;
  }
  return now - lastReloadAt >= RELOAD_GUARD_MS;
}

/** Session storage, or null where it is unavailable (private modes throw). */
function safeSessionStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Reload once when a lazy chunk fails to preload.
 *
 * Call at startup. Without a listener Vite rethrows, which in practice means a
 * blank route for anyone whose tab predates the running deploy.
 */
export function installPreloadRecovery(): void {
  window.addEventListener('vite:preloadError', event => {
    const store = safeSessionStorage();
    const raw = store?.getItem(RELOAD_GUARD_KEY);
    if (!shouldReloadAfterPreloadError(raw === null || raw === undefined ? null : Number(raw), Date.now())) {
      return;
    }
    event.preventDefault();
    store?.setItem(RELOAD_GUARD_KEY, String(Date.now()));
    window.location.reload();
  });
}
