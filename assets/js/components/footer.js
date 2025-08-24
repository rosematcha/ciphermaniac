/**
 * Reusable footer component
 */

export function createFooter(options = {}) {
  const { includeSummary = true, footerClass = 'site-footer' } = options;
  
  const footer = document.createElement('footer');
  footer.className = footerClass;
  
  const summaryDiv = includeSummary ? '<div id="summary" class="summary"></div>' : '';
  
  footer.innerHTML = `
    <div class="footer-inner">
      <div class="footer-left">
        ${summaryDiv}
        <div class="credits">Data sourced from <a href="https://limitlesstcg.com/tournaments/500">LimitlessTCG</a>. UI inspiration from <a href="https://www.trainerhill.com/">TrainerHill</a>.</div>
      </div>
      <div class="footer-right">
        <div><a href="https://x.com/ciphermaniac" target="_blank" rel="noopener noreferrer">Follow on Twitter for updates</a></div>
      </div>
    </div>
  `;
  
  return footer;
}

export function createSimpleFooter() {
  const footer = document.createElement('footer');
  footer.innerHTML = `
    <div class="footer-content">
      <p>&copy; 2025 Ciphermaniac. Pokemon TCG tournament analysis and deck building tools.</p>
    </div>
  `;
  
  return footer;
}

export function insertFooter(container, options = {}) {
  const footer = createFooter(options);
  container.appendChild(footer);
  return footer;
}