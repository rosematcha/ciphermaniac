/**
 * Auto-load next batch of rows when the "Load more" button scrolls into view.
 * Uses IntersectionObserver with a generous rootMargin so cards appear
 * before the user actually reaches the button.
 */

let observer: IntersectionObserver | null = null;
let currentTarget: Element | null = null;

function getObserver(): IntersectionObserver {
  if (!observer) {
    observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const btn = (entry.target as HTMLElement).querySelector('button.btn') as HTMLButtonElement | null;
          if (btn && !btn.disabled) {
            btn.click();
          }
        }
      },
      { rootMargin: '0px 0px 300px 0px' }
    );
  }
  return observer;
}

/**
 * Observe the current `.more-rows` wrapper so it auto-triggers on scroll proximity.
 * Safe to call repeatedly — unobserves the previous target first.
 */
export function observeLoadMore(moreWrap: HTMLElement | null): void {
  const obs = getObserver();
  if (currentTarget) {
    obs.unobserve(currentTarget);
    currentTarget = null;
  }
  if (moreWrap) {
    currentTarget = moreWrap;
    obs.observe(moreWrap);
  }
}
