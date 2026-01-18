import type { GridElement } from '../types.js';

/**
 * Get the grid root element if available.
 */
export function getGridElement(): GridElement | null {
  return document.getElementById('grid') as GridElement | null;
}
