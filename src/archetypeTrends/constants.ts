import { CONFIG } from '../config.js';

export const R2_BASE_URL = CONFIG.API.R2_BASE;

export const PALETTE = [
  '#3b82f6',
  '#ef4444',
  '#22c55e',
  '#f59e0b',
  '#a855f7',
  '#06b6d4',
  '#ec4899',
  '#eab308',
  '#14b8a6',
  '#f97316',
  '#8b5cf6',
  '#10b981'
];

export const CATEGORY_LABELS: Record<string, string> = {
  core: 'Core',
  staple: 'Staple',
  flex: 'Flex',
  tech: 'Tech',
  emerging: 'Emerging',
  fading: 'Fading'
};
