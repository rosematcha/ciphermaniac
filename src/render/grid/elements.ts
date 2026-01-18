import type { GridElement } from '../types.js';

export function getGridElement(): GridElement | null {
  return document.getElementById('grid') as GridElement | null;
}
