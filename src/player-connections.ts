/* eslint-disable no-param-reassign */

import './utils/buildVersion.js';
import { fetchMatches, fetchParticipants, fetchReportResource, fetchTournamentsList } from './api.js';
import { prettyTournamentName } from './utils/format.js';
import { logger } from './utils/logger.js';
import {
  buildPlayerConnectionsGraph,
  type BuildPlayerConnectionsGraphOptions,
  type ConnectionPathResult,
  findConnectionPath,
  normalizePlayerName,
  type PlayerConnectionsGraph,
  type PlayerIdentity
} from './tools/playerConnectionsGraph.js';

interface TournamentIndexPayload {
  tournamentId?: string | number | null;
  labsCode?: string | number | null;
}

interface SearchCandidate {
  key: string;
  label: string;
  normalized: string;
  normalizedName: string;
  playerId: string | null;
}

interface PickerState {
  input: HTMLInputElement;
  suggestions: HTMLUListElement;
  selectedKey: string | null;
  matches: SearchCandidate[];
  activeIndex: number;
  debounceHandle: number | null;
}

const SUGGESTION_LIMIT = 12;

const elements = {
  loading: document.getElementById('player-connections-loading') as HTMLElement | null,
  progressText: document.getElementById('player-connections-progress-text') as HTMLElement | null,
  progressFill: document.getElementById('player-connections-progress-fill') as HTMLElement | null,
  error: document.getElementById('player-connections-error') as HTMLElement | null,
  errorText: document.getElementById('player-connections-error-text') as HTMLElement | null,
  app: document.getElementById('player-connections-app') as HTMLElement | null,
  note: document.getElementById('player-connections-note') as HTMLElement | null,
  stats: document.getElementById('player-connections-stats') as HTMLElement | null,
  searchButton: document.getElementById('player-connections-search') as HTMLButtonElement | null,
  resultSection: document.getElementById('player-connections-results') as HTMLElement | null,
  resultTitle: document.getElementById('player-connections-result-title') as HTMLElement | null,
  resultSummary: document.getElementById('player-connections-result-summary') as HTMLElement | null,
  resultList: document.getElementById('player-connections-result-list') as HTMLUListElement | null,
  playerAInput: document.getElementById('player-a-input') as HTMLInputElement | null,
  playerBInput: document.getElementById('player-b-input') as HTMLInputElement | null,
  playerASuggestions: document.getElementById('player-a-suggestions') as HTMLUListElement | null,
  playerBSuggestions: document.getElementById('player-b-suggestions') as HTMLUListElement | null
};

const state: {
  graph: PlayerConnectionsGraph | null;
  candidates: SearchCandidate[];
  candidateByLabel: Map<string, string>;
  pickerA: PickerState | null;
  pickerB: PickerState | null;
} = {
  graph: null,
  candidates: [],
  candidateByLabel: new Map(),
  pickerA: null,
  pickerB: null
};

function setNote(text: string): void {
  if (elements.note) {
    elements.note.textContent = text;
  }
}

function setLoadingVisible(isVisible: boolean): void {
  if (elements.loading) {
    elements.loading.hidden = !isVisible;
  }
}

function setErrorVisible(isVisible: boolean, message = 'Please try again later.'): void {
  if (elements.error) {
    elements.error.hidden = !isVisible;
  }
  if (elements.errorText) {
    elements.errorText.textContent = message;
  }
}

function setAppVisible(isVisible: boolean): void {
  if (elements.app) {
    elements.app.hidden = !isVisible;
  }
}

function setProgress(phaseText: string, ratio: number): void {
  if (elements.progressText) {
    elements.progressText.textContent = phaseText;
  }
  if (elements.progressFill) {
    const width = Math.max(0, Math.min(100, Math.round(ratio * 100)));
    elements.progressFill.style.width = `${width}%`;
  }
}

function setStats(text: string): void {
  if (elements.stats) {
    elements.stats.textContent = text;
  }
}

function hideSuggestions(picker: PickerState): void {
  picker.suggestions.hidden = true;
  picker.suggestions.innerHTML = '';
  picker.matches = [];
  picker.activeIndex = -1;
}

function getIdentityLabel(identity: PlayerIdentity, graph: PlayerConnectionsGraph): string {
  const nameKeys = graph.nameIndex.get(identity.normalizedName);
  const hasNameCollision = Boolean(nameKeys && nameKeys.size > 1);

  if (identity.playerId) {
    return `${identity.name} (ID ${identity.playerId})`;
  }

  if (hasNameCollision) {
    return `${identity.name} (${identity.key.replace(/^name:/, '')})`;
  }

  return identity.name;
}

function buildSearchCandidates(graph: PlayerConnectionsGraph): SearchCandidate[] {
  const identities = Array.from(graph.identities.values()).sort((left, right) => {
    return left.name.localeCompare(right.name) || left.key.localeCompare(right.key);
  });

  const labels = new Set<string>();

  return identities.map(identity => {
    let label = getIdentityLabel(identity, graph);
    if (labels.has(label)) {
      label = `${label} [${identity.key}]`;
    }
    labels.add(label);

    const normalizedLabel = normalizePlayerName(label);

    return {
      key: identity.key,
      label,
      normalized: `${normalizedLabel} ${identity.playerId || ''}`.trim(),
      normalizedName: identity.normalizedName,
      playerId: identity.playerId
    };
  });
}

function resolveIdentityKey(inputValue: string): string | null {
  const normalizedLabel = normalizePlayerName(inputValue);
  if (!normalizedLabel || !state.graph) {
    return null;
  }

  const exactLabel = state.candidateByLabel.get(normalizedLabel);
  if (exactLabel) {
    return exactLabel;
  }

  const byName = state.graph.nameIndex.get(normalizedLabel);
  if (byName && byName.size === 1) {
    return Array.from(byName)[0];
  }

  return null;
}

function chooseSuggestion(picker: PickerState, candidate: SearchCandidate): void {
  picker.selectedKey = candidate.key;
  picker.input.value = candidate.label;
  hideSuggestions(picker);
}

function renderSuggestions(picker: PickerState, candidates: SearchCandidate[]): void {
  picker.suggestions.innerHTML = '';
  picker.matches = candidates;
  picker.activeIndex = -1;

  if (!candidates.length) {
    picker.suggestions.hidden = true;
    return;
  }

  const fragment = document.createDocumentFragment();
  candidates.forEach((candidate, index) => {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = candidate.label;
    button.addEventListener('mousedown', event => {
      event.preventDefault();
      chooseSuggestion(picker, candidate);
    });
    button.dataset.suggestionIndex = String(index);
    li.appendChild(button);
    fragment.appendChild(li);
  });

  picker.suggestions.appendChild(fragment);
  picker.suggestions.hidden = false;
}

function setActiveSuggestion(picker: PickerState, index: number): void {
  const buttons = picker.suggestions.querySelectorAll('button');
  buttons.forEach(button => button.classList.remove('is-active'));

  if (index < 0 || index >= buttons.length) {
    picker.activeIndex = -1;
    return;
  }

  const active = buttons[index] as HTMLButtonElement;
  active.classList.add('is-active');
  active.scrollIntoView({ block: 'nearest' });
  picker.activeIndex = index;
}

function filterCandidates(query: string): SearchCandidate[] {
  const normalized = normalizePlayerName(query);
  if (!normalized) {
    return [];
  }

  const tokens = normalized.split(' ').filter(Boolean);
  if (!tokens.length) {
    return [];
  }

  const out: SearchCandidate[] = [];
  for (const candidate of state.candidates) {
    const matchesAll = tokens.every(token => candidate.normalized.includes(token));
    if (!matchesAll) {
      continue;
    }
    out.push(candidate);
    if (out.length >= SUGGESTION_LIMIT) {
      break;
    }
  }

  return out;
}

function wirePicker(picker: PickerState): void {
  picker.input.addEventListener('input', () => {
    picker.selectedKey = null;

    if (picker.debounceHandle) {
      window.clearTimeout(picker.debounceHandle);
    }

    picker.debounceHandle = window.setTimeout(() => {
      const matches = filterCandidates(picker.input.value);
      renderSuggestions(picker, matches);
    }, 100);
  });

  picker.input.addEventListener('focus', () => {
    const matches = filterCandidates(picker.input.value);
    renderSuggestions(picker, matches);
  });

  picker.input.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!picker.matches.length) {
        return;
      }
      const next = picker.activeIndex + 1 >= picker.matches.length ? 0 : picker.activeIndex + 1;
      setActiveSuggestion(picker, next);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!picker.matches.length) {
        return;
      }
      const prev = picker.activeIndex <= 0 ? picker.matches.length - 1 : picker.activeIndex - 1;
      setActiveSuggestion(picker, prev);
      return;
    }

    if (event.key === 'Enter') {
      if (picker.activeIndex >= 0 && picker.activeIndex < picker.matches.length) {
        event.preventDefault();
        chooseSuggestion(picker, picker.matches[picker.activeIndex]);
      }
      return;
    }

    if (event.key === 'Escape') {
      hideSuggestions(picker);
    }
  });
}

function formatRoundMeta(round: number | null, phase: number | null, table: number | null): string {
  const segments: string[] = [];
  if (round !== null) {
    segments.push(`Round ${round}`);
  }
  if (phase !== null) {
    segments.push(`Phase ${phase}`);
  }
  if (table !== null) {
    segments.push(`Table ${table}`);
  }
  return segments.join(', ');
}

function formatOutcomeText(
  fromName: string,
  toName: string,
  result: string | null,
  outcomeType: string | null
): string {
  if (outcomeType === 'tie' || result === 'tie') {
    return `${fromName} tied with ${toName}`;
  }
  if (outcomeType === 'double_loss' || result === 'double_loss') {
    return `${fromName} and ${toName} took a double loss`;
  }
  if (result === 'win') {
    return `${fromName} defeated ${toName}`;
  }
  if (result === 'loss') {
    return `${fromName} lost to ${toName}`;
  }
  if (outcomeType === 'bye' || outcomeType === 'unpaired') {
    return `${fromName} had a bye/unpaired result`;
  }
  return `${fromName} played ${toName}`;
}

function renderResults(result: ConnectionPathResult): void {
  if (!elements.resultSection || !elements.resultSummary || !elements.resultList || !elements.resultTitle) {
    return;
  }

  elements.resultSection.hidden = false;
  elements.resultList.innerHTML = '';

  if (result.status === 'not_found') {
    const missingLabel =
      result.missing === 'both'
        ? 'Both players could not be matched to indexed identities.'
        : result.missing === 'source'
          ? 'Player A could not be matched to an indexed identity.'
          : 'Player B could not be matched to an indexed identity.';

    elements.resultTitle.textContent = 'Player not found';
    elements.resultSummary.textContent = missingLabel;
    return;
  }

  if (result.status === 'same') {
    elements.resultTitle.textContent = 'Same player';
    elements.resultSummary.textContent = `${result.identities[0]?.name || 'Player'} has degree 0 to themselves.`;
    return;
  }

  if (result.status === 'disconnected') {
    const source = result.identities[0]?.name || 'Player A';
    const target = result.identities[1]?.name || 'Player B';
    elements.resultTitle.textContent = 'No connection found';
    elements.resultSummary.textContent = `${source} and ${target} are not connected by any tracked direct-match chain.`;
    return;
  }

  const source = result.identities[0]?.name || 'Player A';
  const target = result.identities[result.identities.length - 1]?.name || 'Player B';

  elements.resultTitle.textContent = 'Connection found';
  elements.resultSummary.textContent = `${source} and ${target} are ${result.degree} degree${result.degree === 1 ? '' : 's'} apart.`;

  result.hops.forEach((hop, index) => {
    const item = document.createElement('li');
    item.className = 'connections-result-item';

    const fromIdentity = result.identities[index];
    const toIdentity = result.identities[index + 1];
    const fromName = fromIdentity?.name || 'Unknown Player';
    const toName = toIdentity?.name || 'Unknown Player';

    const title = document.createElement('p');
    title.textContent = `${index + 1}. ${formatOutcomeText(fromName, toName, hop.fromResult, hop.outcomeType)}`;

    const detail = document.createElement('p');
    const roundMeta = formatRoundMeta(hop.round, hop.phase, hop.table);
    const tournament = prettyTournamentName(hop.tournament);
    detail.className = 'connections-note';
    detail.textContent = roundMeta ? `${tournament} · ${roundMeta}` : tournament;

    item.append(title, detail);
    elements.resultList?.appendChild(item);
  });
}

function handleSearch(): void {
  if (!state.graph || !state.pickerA || !state.pickerB) {
    return;
  }

  const sourceKey = state.pickerA.selectedKey || resolveIdentityKey(state.pickerA.input.value);
  const targetKey = state.pickerB.selectedKey || resolveIdentityKey(state.pickerB.input.value);

  const result = findConnectionPath(state.graph, sourceKey, targetKey);
  renderResults(result);

  if (result.status === 'connected') {
    setNote(`Connection found at degree ${result.degree}.`);
  } else if (result.status === 'same') {
    setNote('Selected players resolve to the same identity.');
  } else if (result.status === 'disconnected') {
    setNote('No connection found in the current offline dataset.');
  } else {
    setNote('Please choose valid players from suggestions.');
  }
}

function initPickers(): void {
  if (
    !elements.playerAInput ||
    !elements.playerBInput ||
    !elements.playerASuggestions ||
    !elements.playerBSuggestions
  ) {
    return;
  }

  state.pickerA = {
    input: elements.playerAInput,
    suggestions: elements.playerASuggestions,
    selectedKey: null,
    matches: [],
    activeIndex: -1,
    debounceHandle: null
  };

  state.pickerB = {
    input: elements.playerBInput,
    suggestions: elements.playerBSuggestions,
    selectedKey: null,
    matches: [],
    activeIndex: -1,
    debounceHandle: null
  };

  wirePicker(state.pickerA);
  wirePicker(state.pickerB);

  document.addEventListener('click', event => {
    if (!(event.target instanceof Node)) {
      return;
    }

    if (state.pickerA && !state.pickerA.suggestions.contains(event.target) && event.target !== state.pickerA.input) {
      hideSuggestions(state.pickerA);
    }

    if (state.pickerB && !state.pickerB.suggestions.contains(event.target) && event.target !== state.pickerB.input) {
      hideSuggestions(state.pickerB);
    }
  });
}

function configureSearchButton(): void {
  if (!elements.searchButton) {
    return;
  }

  elements.searchButton.addEventListener('click', () => {
    handleSearch();
  });
}

function updateProgress(progress: {
  phase: 'index' | 'graph';
  completed: number;
  total: number;
  tournament: string;
}): void {
  const safeTotal = Math.max(1, progress.total);
  const phaseRatio = Math.max(0, Math.min(1, progress.completed / safeTotal));
  const progressRatio = progress.phase === 'index' ? phaseRatio * 0.35 : 0.35 + phaseRatio * 0.65;

  const stepText =
    progress.phase === 'index'
      ? `Indexing tournament aliases ${progress.completed}/${progress.total}: ${prettyTournamentName(progress.tournament)}`
      : `Loading player pairings ${progress.completed}/${progress.total}: ${prettyTournamentName(progress.tournament)}`;

  setProgress(stepText, progressRatio);
}

async function fetchTournamentIndexPayload(tournament: string): Promise<TournamentIndexPayload | null> {
  try {
    return await fetchReportResource<TournamentIndexPayload>(
      `${encodeURIComponent(tournament)}/index.json`,
      `index for ${tournament}`,
      'object',
      'tournament index',
      { cache: true }
    );
  } catch {
    return null;
  }
}

async function init(): Promise<void> {
  setLoadingVisible(true);
  setErrorVisible(false);
  setAppVisible(false);
  setProgress('Preparing tournaments...', 0);

  try {
    const tournaments = await fetchTournamentsList();

    const graphOptions: BuildPlayerConnectionsGraphOptions = {
      tournaments,
      fetchTournamentIndex: fetchTournamentIndexPayload,
      fetchParticipants,
      fetchMatches,
      concurrency: 4,
      onProgress: updateProgress
    };

    const graph = await buildPlayerConnectionsGraph(graphOptions);
    state.graph = graph;
    state.candidates = buildSearchCandidates(graph);
    state.candidateByLabel = new Map(
      state.candidates.map(candidate => [normalizePlayerName(candidate.label), candidate.key])
    );

    initPickers();
    configureSearchButton();

    const statsText = `Indexed ${graph.stats.identities.toLocaleString()} identities, ${graph.stats.edgesAdded.toLocaleString()} unique match edges, and ${graph.stats.tournamentsDeduped.toLocaleString()} tournaments.`;
    const failureText = graph.stats.partialFailure
      ? ` Partial load warning: ${graph.stats.tournamentsFailed} tournament(s) failed.`
      : '';

    setStats(`${statsText}${failureText}`);
    setNote(graph.stats.partialFailure ? 'Graph loaded with partial failures.' : 'Graph ready. Choose two players.');

    setProgress('Graph build complete.', 1);
    setAppVisible(true);
  } catch (error) {
    logger.exception('Failed to initialize player connections tool', error);
    setErrorVisible(true, 'Unable to load player connection data right now.');
  } finally {
    setLoadingVisible(false);
  }
}

init().catch(error => {
  logger.exception('Unhandled player connections initialization error', error);
  setErrorVisible(true, 'Unable to load player connection data right now.');
  setLoadingVisible(false);
});
