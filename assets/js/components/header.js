/**
 * Reusable header component
 */

export function createHeader(options = {}) {
  const { currentPage = '', includeIcon = true } = options;
  
  const header = document.createElement('header');
  header.innerHTML = `
    <div class="header-inner">
      <a class="logo" href="./" aria-label="Ciphermaniac home">
        <div class="site-title">ciphermaniac</div>
      </a>
      <nav class="main-nav" aria-label="Main navigation">
        <a class="nav-link${currentPage === 'home' ? ' active' : ''}" href="./">Home</a>
        <a class="nav-link${currentPage === 'cards' ? ' active' : ''}" href="card.html">Cards</a>
        <!-- Temporarily hidden: <a class="nav-link${currentPage === 'synergies' ? ' active' : ''}" href="synergy.html">Synergies</a> -->
      </nav>
    </div>
  `;
  
  return header;
}

export function insertHeader(container, options = {}) {
  const header = createHeader(options);
  container.appendChild(header);
  return header;
}