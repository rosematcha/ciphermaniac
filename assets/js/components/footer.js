/**
 * Reusable footer component
 */

/**
 *
 * @param options
 */
export function createFooter(options = {}) {
  const { footerClass = 'site-footer' } = options;

  const footer = document.createElement('footer');
  footer.className = footerClass;

  footer.innerHTML = `
    <div class="footer-inner">
      <div class="footer-left">
        <div class="credits"><a href="about.html">About & Credits</a></div>
      </div>
      <div class="footer-right">
        <div><a href="https://x.com/ciphermaniac" target="_blank" rel="noopener noreferrer">Follow on Twitter for updates</a></div>
      </div>
    </div>
  `;

  return footer;
}

/**
 *
 */
export function createSimpleFooter() {
  const footer = document.createElement('footer');
  footer.innerHTML = `
    <div class="footer-content">
      <p>&copy; 2025 Ciphermaniac. Pokemon TCG tournament analysis and deck building tools.</p>
    </div>
  `;

  return footer;
}

/**
 *
 * @param container
 * @param options
 */
export function insertFooter(container, options = {}) {
  const footer = createFooter(options);
  container.appendChild(footer);
  return footer;
}
