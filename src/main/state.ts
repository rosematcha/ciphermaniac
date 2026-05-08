import { CleanupManager } from '../utils/performance.js';
import { DataCache } from '../utils/DataCache.js';
import type { DropdownInstance as CardTypeDropdownInstance } from '../components/HierarchicalCardTypeDropdown.js';
import type { DropdownInstance as MultiSelectDropdownInstance } from '../components/MultiSelectDropdown.js';
import type { TournamentReport } from '../types/index.js';

export interface ArchetypeOptionMeta {
  label: string;
  deckCount: number;
}

export type AnyDropdownInstance = MultiSelectDropdownInstance | CardTypeDropdownInstance;

export function isMultiSelectDropdown(dropdown: AnyDropdownInstance): dropdown is MultiSelectDropdownInstance {
  return typeof (dropdown as MultiSelectDropdownInstance).setDisabled === 'function';
}

export interface AppState {
  currentTournament: string | null;
  selectedTournaments: string[];
  selectedSets: string[];
  selectedArchetypes: string[];
  selectedCardType: string;
  successFilter: string;
  availableTournaments: string[];
  availableSets: string[];
  archetypeOptions: Map<string, ArchetypeOptionMeta>;
  current: TournamentReport;
  overrides: Record<string, string>;
  masterCache: Map<string, TournamentReport>;
  archeCache: Map<string, TournamentReport>;
  cleanup: CleanupManager;
  cache: DataCache | null;
  applyArchetypeSelection: ((selection: string[], options?: { force?: boolean }) => Promise<void>) | null;
  ui: {
    dropdowns: Record<string, AnyDropdownInstance | null>;
    openDropdown: string | null;
    onTournamentSelection: ((selection: string[]) => void) | null;
    onSetSelection: ((selection: string[], options?: { silent?: boolean }) => void) | null;
    onArchetypeSelection: ((selection: string[]) => void | Promise<void>) | null;
  };
}

export const DEFAULT_ONLINE_META = 'Online - Last 14 Days';

export const SUCCESS_FILTER_LABELS: Record<string, string> = {
  all: 'all decks',
  winner: 'winners',
  top2: 'finals',
  top4: 'top 4',
  top8: 'top 8',
  top16: 'top 16',
  top10: 'top 10%',
  top25: 'top 25%',
  top50: 'top 50%'
};

export const appState: AppState = {
  currentTournament: null,
  selectedTournaments: [],
  selectedSets: [],
  selectedArchetypes: [],
  selectedCardType: '__all__',
  successFilter: 'all',
  availableTournaments: [],
  availableSets: [],
  archetypeOptions: new Map(),
  current: { items: [], deckTotal: 0 },
  overrides: {},
  masterCache: new Map<string, TournamentReport>(),
  archeCache: new Map<string, TournamentReport>(),
  cleanup: new CleanupManager(),
  cache: null,
  applyArchetypeSelection: null,
  ui: {
    dropdowns: {},
    openDropdown: null,
    onTournamentSelection: null,
    onSetSelection: null,
    onArchetypeSelection: null
  }
};

export let pendingSelectionController: AbortController | null = null;
export function setPendingSelectionController(controller: AbortController | null): void {
  pendingSelectionController = controller;
}
