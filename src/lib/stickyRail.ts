/**
 * Keep a sticky rail reachable when it is taller than the window.
 *
 * `position: sticky; top: X` pins an element by its top edge, so a rail taller
 * than the viewport keeps its bottom out of reach until the page ends. This
 * measures the rail and moves its `top` up by the overflow, so it pins by its
 * bottom edge instead. Nothing else about the layout changes, and a rail that
 * fits keeps the stylesheet's own offset.
 * @param rail - The sticky element
 * @param topInset - Space to keep above the rail when it fits (the nav plus a gap)
 * @param bottomInset - Space to keep below it when it does not
 * @returns Stop observing
 */
export function pinReachable(rail: HTMLElement, topInset: () => number, bottomInset = 16): () => void {
  const { style } = rail;
  const apply = () => {
    const overflow = rail.offsetHeight + topInset() + bottomInset - window.innerHeight;
    style.top = overflow > 0 ? `${topInset() - overflow}px` : '';
  };
  const observer = new ResizeObserver(apply);
  observer.observe(rail);
  window.addEventListener('resize', apply);
  apply();
  return () => {
    observer.disconnect();
    window.removeEventListener('resize', apply);
    style.top = '';
  };
}
