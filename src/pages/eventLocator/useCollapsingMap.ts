import { createSignal, onCleanup, onMount } from 'solid-js';

/**
 * Phones: the map starts at a bit under half the screen and shrinks to a
 * strip as the list scrolls up under it. The shrinking is a scroll-driven CSS
 * variable on the layout, read by both the map slot and the sticky day
 * headers below it, so the headers always park right under the map.
 *
 * The map element itself never changes size (its container clips it), so the
 * map does no relayout while the page scrolls.
 */

const PHONE = '(max-width: 900px)';
const MAP_SHARE = 0.46;
const STRIP_PX = 116;
/** Below this the overlays would crowd the strip, so it becomes a tap target. */
const COLLAPSED_PX = 190;
const FALLBACK_TOPNAV_PX = 114;

function topnavHeight(): number {
  const value = Number.parseFloat(getComputedStyle(document.body).getPropertyValue('--topnav-h'));
  return Number.isFinite(value) ? value : FALLBACK_TOPNAV_PX;
}

export function useCollapsingMap(layout: () => HTMLElement | undefined) {
  const [collapsed, setCollapsed] = createSignal(false);

  onMount(() => {
    const phone = matchMedia(PHONE);
    let frame = 0;
    const update = () => {
      frame = 0;
      const el = layout();
      if (!el) {
        return;
      }
      if (!phone.matches) {
        el.style.removeProperty('--el-map-h');
        el.style.removeProperty('--el-map-full');
        setCollapsed(false);
        return;
      }
      const full = Math.round(innerHeight * MAP_SHARE);
      const scrolled = Math.max(0, topnavHeight() - el.getBoundingClientRect().top);
      const height = Math.max(STRIP_PX, full - scrolled);
      el.style.setProperty('--el-map-full', `${full}px`);
      el.style.setProperty('--el-map-h', `${height}px`);
      setCollapsed(height < COLLAPSED_PX);
    };
    const schedule = () => {
      if (!frame) {
        frame = requestAnimationFrame(update);
      }
    };
    update();
    addEventListener('scroll', schedule, { passive: true });
    addEventListener('resize', schedule);
    phone.addEventListener('change', schedule);
    onCleanup(() => {
      cancelAnimationFrame(frame);
      removeEventListener('scroll', schedule);
      removeEventListener('resize', schedule);
      phone.removeEventListener('change', schedule);
    });
  });

  /** Scroll back up until the map is full height again. */
  const expand = () => {
    const el = layout();
    if (el) {
      scrollTo({ top: el.getBoundingClientRect().top + scrollY - topnavHeight(), behavior: 'smooth' });
    }
  };

  return { collapsed, expand };
}
