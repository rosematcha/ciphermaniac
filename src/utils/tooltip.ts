export interface TooltipManager {
  show: (html: string, x: number, y: number) => void;
  hide: () => void;
  destroy: () => void;
}

export interface TooltipOptions {
  className?: string;
  id?: string;
  role?: 'tooltip' | 'status';
  ariaLive?: 'polite' | 'assertive' | 'off';
}

/**
 * Create a tooltip manager for showing positioned tooltips with viewport clamping.
 * @param options - Configuration options for the tooltip
 * @returns TooltipManager instance with show, hide, and destroy methods
 */
export function createTooltipManager(options?: TooltipOptions): TooltipManager {
  let element: HTMLElement | null = null;
  const className = options?.className || 'graph-tooltip';
  const id = options?.id;
  const role = options?.role || 'tooltip';
  const ariaLive = options?.ariaLive || 'polite';

  function ensure(): HTMLElement {
    if (!element) {
      element = document.createElement('div');
      element.className = className;
      if (id) {
        element.id = id;
      }
      element.setAttribute('role', role);
      if (ariaLive !== 'off') {
        element.setAttribute('aria-live', ariaLive);
      }
      element.style.cssText = 'position:fixed;pointer-events:none;z-index:9999;display:none;';
      document.body.appendChild(element);
    }
    return element;
  }

  return {
    show(html: string, x: number, y: number) {
      const el = ensure();
      el.innerHTML = html;
      el.style.display = 'block';

      // Offset so pointer doesn't overlap
      const offsetX = 12;
      const offsetY = 12;

      // Clamp to viewport
      const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
      const vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
      let left = x + offsetX;
      let top = y + offsetY;

      const rect = el.getBoundingClientRect();
      if (left + rect.width > vw) {
        left = Math.max(8, x - rect.width - offsetX);
      }
      if (top + rect.height > vh) {
        top = Math.max(8, y - rect.height - offsetY);
      }

      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
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

// Shared singleton instances for common use cases
let _gridTooltip: TooltipManager | null = null;
let _graphTooltip: TooltipManager | null = null;

/**
 * Get the shared grid tooltip manager (used by render.ts for card histograms).
 */
export function getGridTooltip(): TooltipManager {
  if (!_gridTooltip) {
    _gridTooltip = createTooltipManager({
      id: 'grid-tooltip',
      role: 'tooltip',
      ariaLive: 'polite'
    });
  }
  return _gridTooltip;
}

/**
 * Get the shared graph tooltip manager (used by card/ui.ts for charts).
 */
export function getGraphTooltip(): TooltipManager {
  if (!_graphTooltip) {
    _graphTooltip = createTooltipManager({
      role: 'status'
    });
  }
  return _graphTooltip;
}
