export interface TooltipManager {
  show: (html: string, x: number, y: number) => void;
  hide: () => void;
  destroy: () => void;
}

export function createTooltipManager(options?: { className?: string }): TooltipManager {
  let element: HTMLElement | null = null;
  const className = options?.className || 'graph-tooltip';

  function ensure(): HTMLElement {
    if (!element) {
      element = document.createElement('div');
      element.className = className;
      element.style.cssText = 'position:fixed;pointer-events:none;z-index:9999;display:none;';
      document.body.appendChild(element);
    }
    return element;
  }

  return {
    show(html: string, x: number, y: number) {
      const el = ensure();
      el.innerHTML = html;
      el.style.left = `${x + 12}px`;
      el.style.top = `${y + 12}px`;
      el.style.display = 'block';
    },
    hide() {
      if (element) {
        element.style.display = 'none';
      }
    },
    destroy() {
      if (element) {
        element.remove();
        element = null;
      }
    }
  };
}
