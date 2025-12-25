/**
 * Types for the render module
 */

export type LayoutMode = 'standard' | 'compact';

export interface RenderOptions {
  layoutMode?: LayoutMode;
  showPrice?: boolean;
}

export interface CachedLayoutMetrics {
  base: number;
  perRowBig: number;
  bigRowContentWidth: number;
  targetMedium: number;
  mediumScale: number;
  targetSmall: number;
  smallScale: number;
  bigRows: number;
  mediumRows: number;
  useSmallRows: boolean;
  forceCompact: boolean;
}

export interface GridElement extends HTMLElement {
  _visibleRows?: number;
  _totalRows?: number;
  _totalCards?: number;
  _moreWrapRef?: HTMLElement | null;
  _layoutMetrics?: CachedLayoutMetrics;
  _renderOptions?: RenderOptions;
  _autoCompact?: boolean;
  _kbNavAttached?: boolean;
  _resizeObserver?: ResizeObserver | null;
  _lastContainerWidth?: number;
}
