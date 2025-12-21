/**
 * HTML escape entities map
 */
const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;'
};

/**
 * Escapes HTML special characters to prevent XSS
 */
export function escapeHtml(str: string | null | undefined): string {
  if (!str) {
    return '';
  }
  return String(str).replace(/[&<>"']/g, ch => HTML_ENTITIES[ch] || ch);
}
