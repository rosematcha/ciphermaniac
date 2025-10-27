/**
 * Reusable header component
 */

/**
 *
 * @param options
 */
export function createHeader(options = {}) {
  const { currentPage = '' } = options;

  const header = document.createElement('header');
  header.innerHTML = `
    <div class="header-inner">
      <a class="logo" href="/" aria-label="Ciphermaniac home">
        <div class="site-title">ciphermaniac</div>
      </a>
      <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="mainNav">
        <span class="nav-toggle__icon" aria-hidden="true"></span>
        <span class="nav-toggle__text">Menu</span>
      </button>
    <nav class="main-nav" aria-label="Main navigation">
  <a class="nav-link${currentPage === 'trends' ? ' active' : ''}" href="/trends">View Trends</a>
  <a class="nav-link${currentPage === 'analysis' || currentPage === 'archetypes' ? ' active' : ''}" href="/archetypes">Archetypes</a>
  <a class="nav-link${currentPage === 'feedback' ? ' active' : ''}" href="/feedback.html">Feedback</a>
      </nav>
    </div>
  `;

  const nav = /** @type {HTMLElement | null} */ (header.querySelector('.main-nav'));
  const toggle = /** @type {HTMLButtonElement | null} */ (header.querySelector('.nav-toggle'));

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
    const handleChange = event => {
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
 *
 * @param container
 * @param options
 */
export function insertHeader(container, options = {}) {
  const header = createHeader(options);
  container.appendChild(header);
  return header;
}
