/**
 * Whether a click on a table row should act for the row: an unmodified primary
 * click that lands outside the row's own links and buttons, with no text being
 * selected. Dragging across a figure to copy it, or a ctrl/cmd-click meant for
 * a new tab, leaves the page where it is.
 */
export function isRowClick(event: MouseEvent): boolean {
  const modified = event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
  if (modified || globalThis.getSelection?.()?.toString()) {
    return false;
  }
  return !(event.target as Element | null)?.closest('a, button');
}

/**
 * A row's click goes to the link in its name cell, so the whole row is one
 * target while the keyboard and screen readers get a real link.
 */
export function followRowLink(event: MouseEvent & { currentTarget: HTMLElement }): void {
  if (isRowClick(event)) {
    event.currentTarget.querySelector<HTMLAnchorElement>('.col-name a')?.click();
  }
}
