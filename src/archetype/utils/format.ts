/**
 * Decode an archetype label from URL-safe value.
 * @param value - Encoded label.
 */
export function decodeArchetypeLabel(value: string): string {
  return value.replace(/_/g, ' ');
}

/**
 * Format event name for display.
 * @param eventName - Raw event name.
 */
export function formatEventName(eventName: string): string {
  return eventName.replace(/^[\d-]+,\s*/u, '');
}

/**
 * Format card numbers for TCG Live exports.
 * @param value - Card number value.
 */
export function formatTcgliveCardNumber(value: string | number | null | undefined): string {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return '';
  }
  const match = raw.match(/^0*([0-9]+)([A-Za-z]*)$/);
  if (match) {
    const digits = match[1] ? String(Number(match[1])) : '0';
    const suffix = match[2] || '';
    return `${digits}${suffix.toUpperCase()}`;
  }
  if (/^\d+$/.test(raw)) {
    return String(Number(raw));
  }
  return raw.toUpperCase();
}
