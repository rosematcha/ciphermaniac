/**
 * Reusable footer component
 */
/**
 * Creates a standard footer element
 * @param options - Configuration options
 * @returns The footer element
 */
export function createFooter(options = {}) {
    const { footerClass = 'site-footer' } = options;
    const footer = document.createElement('footer');
    footer.className = footerClass;
    footer.innerHTML = `
    <div class="footer-inner">
      <div class="footer-left">
        <div class="credits"><a href="/about.html">About & Credits</a></div>
      </div>
      <div class="footer-right">
        <div><a href="https://x.com/ciphermaniac" target="_blank" rel="noopener noreferrer">Follow on Twitter for updates</a></div>
      </div>
    </div>
  `;
    // Add class for browsers without :has() support (CLS prevention fallback)
    document.body.classList.add('has-footer');
    return footer;
}
/**
 * Creates a simple footer element
 * @returns The footer element
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
 * Inserts a footer into a container
 * @param container - The container element
 * @param options - Configuration options
 * @returns The inserted footer element
 */
export function insertFooter(container, options = {}) {
    const footer = createFooter(options);
    container.appendChild(footer);
    return footer;
}
