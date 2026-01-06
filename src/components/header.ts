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
    <a class="skip-link" href="#main-content">Skip to main content</a>
    <div class="header-inner">
      <a class="logo" href="/" aria-label="Ciphermaniac home">
        <img src="/assets/images/logo.svg" alt="" class="site-logo" width="28" height="28" />
        <div class="site-title">Ciphermaniac</div>
      </a>
      <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="mainNav" aria-label="Toggle navigation menu">
        <span class="nav-toggle__icon" aria-hidden="true"></span>
        <span class="nav-toggle__text">Menu</span>
      </button>
    <nav class="main-nav" id="mainNav" aria-label="Main navigation">
      <a class="nav-link${currentPage === 'cards' ? ' active' : ''}" href="/cards"${currentPage === 'cards' ? ' aria-current="page"' : ''}>Cards</a>
      <a class="nav-link${currentPage === 'trends' ? ' active' : ''}" href="/trends"${currentPage === 'trends' ? ' aria-current="page"' : ''}>Trends</a>
      <a class="nav-link${currentPage === 'analysis' || currentPage === 'archetypes' ? ' active' : ''}" href="/archetypes"${currentPage === 'analysis' || currentPage === 'archetypes' ? ' aria-current="page"' : ''}>Archetypes</a>
      <a class="nav-link${currentPage === 'feedback' ? ' active' : ''}" href="/feedback.html"${currentPage === 'feedback' ? ' aria-current="page"' : ''}>Feedback</a>
    </nav>
    </div>
  `;

  // Add class for browsers without :has() support (CLS prevention fallback)
  document.body.classList.add('has-header');

  const nav = header.querySelector('.main-nav') as HTMLElement | null;
  const toggle = header.querySelector('.nav-toggle') as HTMLButtonElement | null;

  if (nav && toggle) {
    const openNav = () => {
      nav.classList.add('is-open');
      toggle.classList.add('is-active');
      toggle.setAttribute('aria-expanded', 'true');
      // Focus first nav link when opening
      const firstLink = nav.querySelector('.nav-link') as HTMLElement | null;
      firstLink?.focus();
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

      // Arrow key navigation within nav
      const navLinks = Array.from(nav.querySelectorAll('.nav-link')) as HTMLElement[];
      const currentIndex = navLinks.indexOf(document.activeElement as HTMLElement);

      if (currentIndex >= 0) {
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
          event.preventDefault();
          const nextIndex = (currentIndex + 1) % navLinks.length;
          navLinks[nextIndex]?.focus();
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
          event.preventDefault();
          const prevIndex = (currentIndex - 1 + navLinks.length) % navLinks.length;
          navLinks[prevIndex]?.focus();
        } else if (event.key === 'Home') {
          event.preventDefault();
          navLinks[0]?.focus();
        } else if (event.key === 'End') {
          event.preventDefault();
          navLinks[navLinks.length - 1]?.focus();
        }
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
