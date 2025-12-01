/**
 * Common DOM/Fetch type shims (kept in one place to avoid duplicating aliases).
 * These mirror the minimal shapes we rely on in the frontend.
 */

export type DomEventListener = (evt: Event) => any;
export type DomEventListenerOrEventListenerObject =
  | DomEventListener
  | {
      handleEvent: (evt: Event) => any;
    };

export type DomAddEventListenerOptions = boolean | AddEventListenerOptions;

/**
 * Minimal RequestInit shape for fetch options used in the repo.
 * Extends the built-in RequestInit to allow loose typing on headers/body where needed.
 */
export interface DomRequestInit extends RequestInit {
  headers?: Record<string, string> | RequestInit['headers'];
  body?: BodyInit | null;
}
