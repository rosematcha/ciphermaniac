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
      <nav class="main-nav" aria-label="Main navigation">
  <a class="nav-link${currentPage === 'home' ? ' active' : ''}" href="/">Home</a>
  <a class="nav-link${currentPage === 'cards' ? ' active' : ''}" href="/card">Cards</a>
  <a class="nav-link${currentPage === 'feedback' ? ' active' : ''}" href="/feedback.html">Feedback</a>
      </nav>
    </div>
  `;

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
