/**
 * Keeping Tab inside a modal layer (a sheet or dialog marked aria-modal):
 * focus wraps from the last control to the first and back, and a Tab from
 * anywhere outside it comes back in.
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => !el.hasAttribute('disabled'));
}

/** Handles a Tab keydown so focus stays within `root`; other keys pass through. */
export function keepTabIn(root: HTMLElement, event: KeyboardEvent): void {
  if (event.key !== 'Tab') {
    return;
  }
  const nodes = focusableIn(root);
  const first = nodes[0];
  const last = nodes.at(-1);
  if (!first || !last) {
    event.preventDefault();
    return;
  }
  const active = document.activeElement;
  const outside = !root.contains(active);
  if (event.shiftKey && (outside || active === first)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (outside || active === last)) {
    event.preventDefault();
    first.focus();
  }
}
