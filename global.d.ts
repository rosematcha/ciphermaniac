declare global {
  interface Window {
    cleanupProgress?: () => void;
    __imagePreloaderListeners?: EventListener[];
    Image: typeof Image;
  }

  // Note: We extend HTMLElement to add custom properties, not to override standard DOM methods
  interface HTMLElement {
    value?: string;
    _hoverPrefetchAttached?: boolean;
    _visibleRows?: number;
    _totalRows?: number;
    _totalCards?: number;
    _moreWrapRef?: HTMLElement | null;
    _kbNavAttached?: boolean;
    _layoutMetrics?: {
      base: number;
      perRowBig: number;
      bigRowContentWidth: number;
      targetSmall: number;
      smallScale: number;
      bigRows: number;
    };
  }

  interface HTMLDivElement {
    updateStatus?: (status: string, detail?: string) => void;
  }

  interface HTMLImageElement {
    _loadingState?: {
      candidates: string[];
      idx: number;
      loading: boolean;
      fallbackAttempted?: boolean;
    };
  }
}

export {};
