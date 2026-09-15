import { createSignal, onCleanup, onMount } from 'solid-js';

/**
 * Phones: the map sits on top of the list and scrolls up under the header
 * until only a strip of its bottom edge is left, which then sticks. That is
 * all CSS (a sticky slot with a negative offset), so the browser moves it on
 * the compositor and it never lags the finger. The map element keeps one
 * size the whole time.
 *
 * This hook only answers whether the map has scrolled far enough that its
 * controls would crowd the strip, from an IntersectionObserver on a marker
 * placed that far above the map's bottom edge.
 */

const PHONE = '(max-width: 900px)';
const FALLBACK_TOPNAV_PX = 114;

function topnavHeight(): number {
  const value = Number.parseFloat(getComputedStyle(document.body).getPropertyValue('--topnav-h'));
  return Number.isFinite(value) ? value : FALLBACK_TOPNAV_PX;
}

export function useCollapsingMap(layout: () => HTMLElement | undefined) {
  const [collapsed, setCollapsed] = createSignal(false);
  const [phone, setPhone] = createSignal(false);

  onMount(() => {
    const query = matchMedia(PHONE);
    let observer: IntersectionObserver | undefined;
    const watch = () => {
      observer?.disconnect();
      setPhone(query.matches);
      setCollapsed(false);
      const marker = layout()?.querySelector('.el-map-collapse');
      if (!query.matches || !marker) {
        return;
      }
      const top = topnavHeight();
      observer = new IntersectionObserver(
        ([entry]) => {
          // Out of view below the fold is not collapsed; only above, under the header.
          setCollapsed(Boolean(entry && !entry.isIntersecting && entry.boundingClientRect.top < top));
        },
        { rootMargin: `-${top}px 0px 0px 0px` }
      );
      observer.observe(marker);
    };
    watch();
    query.addEventListener('change', watch);
    onCleanup(() => {
      observer?.disconnect();
      query.removeEventListener('change', watch);
    });
  });

  /** Scroll back up until the map is whole again. */
  const expand = () => {
    const el = layout();
    if (el) {
      scrollTo({ top: el.getBoundingClientRect().top + scrollY - topnavHeight(), behavior: 'smooth' });
    }
  };

  return { collapsed, phone, expand };
}
