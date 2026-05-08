import { analyzeEvents, type BinderDataset, computeThresholdCopies } from '../metaBinderData.js';
import { AppError, ErrorTypes } from '../../utils/errorHandler.js';

export const DEFAULT_RECENT_EVENTS = 6;
export const CARDS_PER_PAGE = 12;
export const TOURNAMENTS_DEFAULT_VISIBLE = 15;
export const ARCHETYPES_MIN_DECK_COUNT = 2;
export const STORAGE_KEY = 'binderSelections';
export const DEFAULT_ONLINE_META = 'Online - Last 14 Days';

export type AnalysisResult = ReturnType<typeof analyzeEvents>;
export type BinderSelections = { tournaments: string[]; archetypes: string[] };
export type AnalysisEvent = NonNullable<Parameters<typeof analyzeEvents>[0]>[number];
export type DeckRecord = AnalysisEvent['decks'][number];
export type BinderSection = BinderDataset['sections'][keyof BinderDataset['sections']];
export type BinderArchetypeGroup = BinderDataset['sections']['archetypePokemon'][number];
export type BinderCard = Exclude<BinderSection extends Array<infer T> ? T : never, BinderArchetypeGroup>;

export interface BinderMetrics {
  priceTotal: number;
  missingPrices: number;
  coverageSelected: number;
  coverageMeta: number;
}

export interface CardRenderOptions {
  mode?: 'all' | 'archetype';
  archetype?: string;
}

export interface BinderMetricsContext {
  selectedDecks?: number;
  metaDecks?: number;
}

export interface BinderElements {
  tournamentsList: HTMLElement | null;
  tournamentsAll: HTMLElement | null;
  tournamentsRecent: HTMLElement | null;
  tournamentsClear: HTMLElement | null;
  archetypesList: HTMLElement | null;
  archetypesAll: HTMLElement | null;
  archetypesClear: HTMLElement | null;
  archetypeSearch: HTMLInputElement | null;
  stats: HTMLElement | null;
  loading: HTMLElement | null;
  error: HTMLElement | null;
  errorMessage: HTMLElement | null;
  content: HTMLElement | null;
  app: HTMLElement | null;
  generate: HTMLButtonElement | null;
  pendingMessage: HTMLElement | null;
  cardTemplate: HTMLTemplateElement | null;
  placeholderTemplate: HTMLTemplateElement | null;
  exportButton: HTMLButtonElement | null;
  exportPtcgLiveButton: HTMLButtonElement | null;
  importButton: HTMLButtonElement | null;
  importFile: HTMLInputElement | null;
  thresholdSlider: HTMLInputElement | null;
  thresholdValueLabel: HTMLElement | null;
  includeThresholdSlider: HTMLInputElement | null;
  includeThresholdValueLabel: HTMLElement | null;
  placementFilterSelect: HTMLSelectElement | null;
}

export const state: {
  tournaments: string[];
  selectedTournaments: Set<string>;
  decksCache: Map<string, DeckRecord[]>;
  overrides: Record<string, string>;
  analysis: AnalysisResult | null;
  binderData: BinderDataset | null;
  selectedArchetypes: Set<string>;
  archetypeFilter: string;
  isLoading: boolean;
  isGenerating: boolean;
  isBinderDirty: boolean;
  selectionDecks: number;
  metrics: BinderMetrics | null;
  copyThreshold: number;
  includeThreshold: number;
  placementFilter: number;
  showAllTournaments: boolean;
  showAllArchetypes: boolean;
} = {
  tournaments: [],
  selectedTournaments: new Set(),
  decksCache: new Map(),
  overrides: {},
  analysis: null,
  binderData: null,
  selectedArchetypes: new Set(),
  archetypeFilter: '',
  isLoading: false,
  isGenerating: false,
  isBinderDirty: true,
  selectionDecks: 0,
  metrics: null,
  copyThreshold: 0,
  includeThreshold: 0,
  placementFilter: 0,
  showAllTournaments: false,
  showAllArchetypes: false
};

export let pendingArchetypeSelection: Set<string> | null = null;
export function setPendingArchetypeSelection(value: Set<string> | null): void {
  pendingArchetypeSelection = value;
}

export const elements: BinderElements = {
  tournamentsList: document.getElementById('binder-tournaments'),
  tournamentsAll: document.getElementById('binder-tournaments-all'),
  tournamentsRecent: document.getElementById('binder-tournaments-recent'),
  tournamentsClear: document.getElementById('binder-tournaments-clear'),
  archetypesList: document.getElementById('binder-archetypes'),
  archetypesAll: document.getElementById('binder-archetypes-all'),
  archetypesClear: document.getElementById('binder-archetypes-clear'),
  archetypeSearch: document.getElementById('binder-archetype-search') as HTMLInputElement | null,
  stats: document.getElementById('binder-stats'),
  loading: document.getElementById('binder-loading'),
  error: document.getElementById('binder-error'),
  errorMessage: document.getElementById('binder-error-message'),
  content: document.getElementById('binder-content'),
  app: document.querySelector('.binder-app') as HTMLElement | null,
  generate: document.getElementById('binder-generate') as HTMLButtonElement | null,
  pendingMessage: document.getElementById('binder-pending'),
  cardTemplate: document.getElementById('binder-card-template') as HTMLTemplateElement | null,
  placeholderTemplate: document.getElementById('binder-card-placeholder') as HTMLTemplateElement | null,
  exportButton: document.getElementById('binder-export') as HTMLButtonElement | null,
  exportPtcgLiveButton: document.getElementById('binder-export-ptcg-live') as HTMLButtonElement | null,
  importButton: document.getElementById('binder-import') as HTMLButtonElement | null,
  importFile: document.getElementById('binder-import-file') as HTMLInputElement | null,
  thresholdSlider: document.getElementById('binder-copy-threshold') as HTMLInputElement | null,
  thresholdValueLabel: document.getElementById('binder-threshold-value'),
  includeThresholdSlider: document.getElementById('binder-include-threshold') as HTMLInputElement | null,
  includeThresholdValueLabel: document.getElementById('binder-include-threshold-value'),
  placementFilterSelect: document.getElementById('binder-placement-filter') as HTMLSelectElement | null
};

export function setLoading(isLoading: boolean): void {
  state.isLoading = isLoading;
  if (!elements.app || !elements.loading || !elements.content) {
    return;
  }
  elements.app.dataset.state = isLoading ? 'loading' : 'ready';
  elements.loading.hidden = !isLoading;
  elements.content.hidden = isLoading;
  if (isLoading) {
    elements.content.setAttribute('aria-hidden', 'true');
  } else {
    elements.content.removeAttribute('aria-hidden');
  }
  updateGenerateState();
}

export function showError(message: string): void {
  if (!elements.error || !elements.errorMessage || !elements.content || !elements.loading) {
    return;
  }
  elements.loading.hidden = true;
  elements.error.hidden = false;
  elements.content.hidden = true;
  elements.errorMessage.textContent = message;
  updateGenerateState();
}

export function hideError() {
  if (elements.error) {
    elements.error.hidden = true;
  }
}

export function setPendingMessage(message: string): void {
  if (elements.pendingMessage) {
    elements.pendingMessage.textContent = message;
  }
}

export function updateGenerateState() {
  if (elements.generate) {
    const hasSelection = state.selectedTournaments.size > 0;
    const actionable = !state.isLoading && !state.isGenerating && state.analysis && hasSelection;
    elements.generate.disabled = !actionable;
  }

  if (!elements.pendingMessage) {
    return;
  }

  if (state.isLoading) {
    setPendingMessage('Loading selection data...');
    return;
  }
  if (!state.selectedTournaments.size) {
    setPendingMessage('Select at least one event to enable layout generation.');
    return;
  }
  if (state.isBinderDirty) {
    setPendingMessage('Selections updated. Click "Generate Binder" to refresh the layout.');
    return;
  }
  if (state.binderData) {
    const decks = state.binderData.meta.totalDecks;
    setPendingMessage(`Layout generated for ${decks} deck${decks === 1 ? '' : 's'}.`);
    return;
  }
  setPendingMessage('Click "Generate Binder" to build your layout.');
}

export function formatPercent(value: number): string {
  const percent = Math.round(value * 1000) / 10;
  return `${percent.toFixed(percent % 1 === 0 ? 0 : 1)}%`;
}

export function formatFractionUsage(decks: number, total: number): string {
  return `${decks}/${total} decks`;
}

export function formatCurrency(value: number): string {
  if (!Number.isFinite(value)) {
    return '$0.00';
  }
  return `$${value.toFixed(2)}`;
}

export function normalizeId(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
}

export function chunk<T>(array: T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let index = 0; index < array.length; index += size) {
    pages.push(array.slice(index, index + size));
  }
  return pages;
}

export function ensureCardTemplate(): HTMLTemplateElement {
  if (!elements.cardTemplate) {
    throw new AppError(ErrorTypes.RENDER, 'Card template missing');
  }
  return elements.cardTemplate;
}

export function ensurePlaceholderTemplate(): HTMLTemplateElement {
  if (!elements.placeholderTemplate) {
    throw new AppError(ErrorTypes.RENDER, 'Placeholder template missing');
  }
  return elements.placeholderTemplate;
}

export function getEffectiveCopies(card: BinderCard): number {
  if (state.copyThreshold <= 0 || !card.copyDistribution || Object.keys(card.copyDistribution).length === 0) {
    return Math.max(1, card.maxCopies || 1);
  }
  return Math.max(1, computeThresholdCopies(card.copyDistribution, card.totalDecksWithCard, state.copyThreshold));
}

export function getCardIncludeRatio(card: BinderCard, options: CardRenderOptions): number {
  if (options.mode === 'archetype' && options.archetype) {
    const usage = card.usageByArchetype.find(entry => entry.archetype === options.archetype);
    const archetypeRatio = usage ? usage.ratio : 0;
    return Math.min(archetypeRatio, card.deckShare);
  }
  return card.deckShare;
}
