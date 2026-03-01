/**
 * Back-to-top floating action button.
 * Shows after the user scrolls past one viewport height.
 */

let btn: HTMLButtonElement | null = null;

export function initBackToTop(): void {
  btn = document.createElement('button');
  btn.className = 'back-to-top';
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Back to top');
  btn.innerHTML = '↑';
  btn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  document.body.appendChild(btn);

  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      if (!btn) return;
      const show = window.scrollY > window.innerHeight;
      btn.classList.toggle('is-visible', show);
    });
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}
