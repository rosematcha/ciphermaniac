/**
 * Reusable header component
 */

import '../utils/buildVersion.js';

interface HeaderOptions {
  currentPage?: string;
}

/**
 * Creates the header element
 * @param options - Configuration options
 * @returns The header element
 */
export function createHeader(options: HeaderOptions = {}): HTMLElement {
  const { currentPage = '' } = options;

  const header = document.createElement('header');
  header.className = 'site-header';
  header.innerHTML = `
    <div class="header-inner">
      <a class="logo" href="/" aria-label="Ciphermaniac home">
        <img src="/assets/images/logo.svg" alt="" class="site-logo" width="28" height="28" />
        <div class="site-title">Ciphermaniac</div>
      </a>
      <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="mainNav">
        <span class="nav-toggle__icon" aria-hidden="true"></span>
        <span class="nav-toggle__text">Menu</span>
      </button>
    <nav class="main-nav" aria-label="Main navigation">
      <a class="nav-link${currentPage === 'cards' ? ' active' : ''}" href="/cards">Cards</a>
      <a class="nav-link${currentPage === 'trends' ? ' active' : ''}" href="/trends">Trends</a>
      <a class="nav-link${currentPage === 'analysis' || currentPage === 'archetypes' ? ' active' : ''}" href="/archetypes">Archetypes</a>
      <a class="nav-link${currentPage === 'feedback' ? ' active' : ''}" href="/feedback.html">Feedback</a>
    </nav>
    </div>
  `;

  // Add class for browsers without :has() support (CLS prevention fallback)
  document.body.classList.add('has-header');

  const nav = header.querySelector('.main-nav') as HTMLElement | null;
  const toggle = header.querySelector('.nav-toggle') as HTMLButtonElement | null;

  if (nav && toggle) {
    nav.id = 'mainNav';

    const openNav = () => {
      nav.classList.add('is-open');
      toggle.classList.add('is-active');
      toggle.setAttribute('aria-expanded', 'true');
    };

    const closeNav = () => {
      nav.classList.remove('is-open');
      toggle.classList.remove('is-active');
      toggle.setAttribute('aria-expanded', 'false');
    };

    toggle.addEventListener('click', () => {
      const expanded = toggle.getAttribute('aria-expanded') === 'true';
      if (expanded) {
        closeNav();
      } else {
        openNav();
      }
    });

    nav.addEventListener('click', event => {
      const { target } = event;
      if (target instanceof Element && target.closest('.nav-link')) {
        closeNav();
      }
    });

    nav.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        closeNav();
        toggle.focus();
      }
    });

    const { matchMedia } = window;
    const mq = matchMedia('(min-width: 721px)');
    const handleChange = (event: MediaQueryListEvent) => {
      if (event.matches) {
        closeNav();
      }
    };
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', handleChange);
    } else if (typeof mq.addListener === 'function') {
      mq.addListener(handleChange);
    }
  }

  return header;
}

/**
 * Inserts the header into a container
 * @param container - The container element
 * @param options - Configuration options
 * @returns The inserted header element
 */
export function insertHeader(container: HTMLElement, options: HeaderOptions = {}): HTMLElement {
  const header = createHeader(options);
  container.appendChild(header);
  return header;
}
