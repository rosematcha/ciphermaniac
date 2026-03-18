/* eslint-disable no-param-reassign */

import './utils/buildVersion.js';
import { fetchMatches, fetchParticipants, fetchReportResource, fetchTournamentsList } from './api.js';
import { prettyTournamentName } from './utils/format.js';
import { logger } from './utils/logger.js';
import {
  buildPlayerConnectionsGraph,
  type BuildPlayerConnectionsGraphOptions,
  computeGraphInterestingStats,
  type ConnectionPathResult,
  findConnectionPath,
  findFurthestConnectionFrom,
  type FurthestConnectionResult,
  type GraphInterestingStats,
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

interface LoadingInsightCache {
  builtAt: string;
  identities: number;
  edges: number;
  tournaments: number;
  largestComponentShare: number;
  averageOpponents: number;
  mostConnectedPlayer: string | null;
  mostConnectedDegree: number;
  longestRouteEstimate: number;
  mostActivePlayer: string | null;
  mostActivePlayerMatches: number;
  mostFrequentPairing: string | null;
  mostFrequentPairingMatches: number;
}

interface PairQueryState {
  mode: 'pair';
  sourceKey: string;
  targetKey: string;
  seenPathSignatures: Set<string>;
}

interface FurthestQueryState {
  mode: 'furthest';
  sourceKey: string;
  seenPathSignatures: Set<string>;
}

type LastQueryState = PairQueryState | FurthestQueryState;

const SUGGESTION_LIMIT = 12;
const LOADING_TIP_INTERVAL_MS = 3600;
const LOADING_TIP_FADE_MS = 220;
const LOADING_INSIGHTS_STORAGE_KEY = 'playerConnections.loadingInsights.v1';
const HARD_BAKED_INTERESTING_STATS = [
  'Interesting stat: Largest cluster covers about 99% of indexed players.',
  'Interesting stat: Longest known pairing is Mirko Pivari to Sebastian Gonzalez at 8 degrees.',
  'Interesting stat: Top direct-opponent counts are Gabriel Smart (396), Brent Tonisson (334), and Rahul Reddy (317).',
  'Interesting stat: Top tracked-match counts are Gabriel Smart (407), Brent Tonisson (365), and Rahul Reddy (325).',
  'Interesting stat: High direct-opponent counts include Julius Brunfeldt (287), Caleb Rogerson (285), and Nathan Ginsburg (285).',
  'Interesting stat: Most frequent pairing was Henry Chao vs Piper Lepine (5 matches).',
  'Interesting stat: Michael Davidson and Aidan Khus have faced each other 5 times.',
  'Interesting stat: Four-match rivalries include Caleb Rogerson vs Brent Tonisson and Andrew Hedrick vs Xander Pero.',
  'Interesting stat: High tracked-match counts include Caleb Rogerson (303), Julius Brunfeldt (297), and Owen Dalgard (295).',
  'Interesting stat: 3 players have 300+ unique opponents, and 11 players have 250+.',
  'Interesting stat: 4 players have 300+ tracked matches, and 19 players have 250+.'
];
const BASE_LOADING_TIPS = [
  'Tip: Degree 1 means the players faced each other directly.',
  'Tip: Byes and unpaired rounds are ignored for connection edges.',
  'Tip: Identity matching prioritizes global player IDs over names.',
  'Tip: Paths use shortest-hop BFS, so results are the minimum known degrees.'
];

const elements = {
  loading: document.getElementById('player-connections-loading') as HTMLElement | null,
  loadingInsights: document.getElementById('player-connections-loading-insights') as HTMLElement | null,
  progressText: document.getElementById('player-connections-progress-text') as HTMLElement | null,
  progressFill: document.getElementById('player-connections-progress-fill') as HTMLElement | null,
  loadingTip: document.getElementById('player-connections-loading-tip') as HTMLElement | null,
  error: document.getElementById('player-connections-error') as HTMLElement | null,
  errorText: document.getElementById('player-connections-error-text') as HTMLElement | null,
  app: document.getElementById('player-connections-app') as HTMLElement | null,
  note: document.getElementById('player-connections-note') as HTMLElement | null,
  stats: document.getElementById('player-connections-stats') as HTMLElement | null,
  searchButton: document.getElementById('player-connections-search') as HTMLButtonElement | null,
  furthestButton: document.getElementById('player-connections-furthest') as HTMLButtonElement | null,
  rerollButton: document.getElementById('player-connections-reroll') as HTMLButtonElement | null,
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
  loadingTips: string[];
  loadingTipIndex: number;
  loadingTipTimer: number | null;
  loadingTipFadeHandle: number | null;
  lastQuery: LastQueryState | null;
} = {
  graph: null,
  candidates: [],
  candidateByLabel: new Map(),
  pickerA: null,
  pickerB: null,
  loadingTips: [],
  loadingTipIndex: 0,
  loadingTipTimer: null,
  loadingTipFadeHandle: null,
  lastQuery: null
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
  if (elements.loadingInsights) {
    elements.loadingInsights.hidden = !isVisible;
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

function setRerollEnabled(enabled: boolean): void {
  if (elements.rerollButton) {
    elements.rerollButton.disabled = !enabled;
  }
}

function clearLastQueryState(): void {
  state.lastQuery = null;
  setRerollEnabled(false);
}

function pathSignatureFromIdentities(identities: PlayerIdentity[]): string {
  return identities.map(identity => identity.key).join('>');
}

function setLoadingTip(text: string): void {
  if (!elements.loadingTip) {
    return;
  }

  const currentText = elements.loadingTip.textContent || '';
  if (currentText === text && elements.loadingTip.classList.contains('is-visible')) {
    return;
  }

  if (state.loadingTipFadeHandle) {
    window.clearTimeout(state.loadingTipFadeHandle);
    state.loadingTipFadeHandle = null;
  }

  elements.loadingTip.classList.remove('is-visible');
  state.loadingTipFadeHandle = window.setTimeout(() => {
    if (!elements.loadingTip) {
      return;
    }
    elements.loadingTip.textContent = text;
    elements.loadingTip.classList.add('is-visible');
    state.loadingTipFadeHandle = null;
  }, LOADING_TIP_FADE_MS);
}

function showLoadingTipImmediately(text: string): void {
  if (!elements.loadingTip) {
    return;
  }
  if (state.loadingTipFadeHandle) {
    window.clearTimeout(state.loadingTipFadeHandle);
    state.loadingTipFadeHandle = null;
  }
  elements.loadingTip.textContent = text;
  elements.loadingTip.classList.add('is-visible');
}

function formatPercent(ratio: number): string {
  const pct = Math.max(0, Math.min(100, ratio * 100));
  const rounded = pct >= 10 ? Math.round(pct) : Math.round(pct * 10) / 10;
  return `${rounded}%`;
}

function writeCachedInsights(graph: PlayerConnectionsGraph, insights: GraphInterestingStats): void {
  const mostConnected = insights.mostConnectedKey ? graph.identities.get(insights.mostConnectedKey) : null;
  const mostActive = insights.mostActivePlayerKey ? graph.identities.get(insights.mostActivePlayerKey) : null;
  const mostFrequentPairingLabel =
    insights.mostFrequentPairing && insights.mostFrequentPairing.leftKey && insights.mostFrequentPairing.rightKey
      ? `${graph.identities.get(insights.mostFrequentPairing.leftKey)?.name || insights.mostFrequentPairing.leftKey} vs ${graph.identities.get(insights.mostFrequentPairing.rightKey)?.name || insights.mostFrequentPairing.rightKey}`
      : null;

  const payload: LoadingInsightCache = {
    builtAt: new Date().toISOString(),
    identities: graph.stats.identities,
    edges: graph.stats.edgesAdded,
    tournaments: graph.stats.tournamentsDeduped,
    largestComponentShare: graph.stats.largestComponentShare,
    averageOpponents: insights.averageOpponents,
    mostConnectedPlayer: mostConnected?.name || null,
    mostConnectedDegree: insights.mostConnectedDegree,
    longestRouteEstimate: insights.longestRouteEstimate,
    mostActivePlayer: mostActive?.name || null,
    mostActivePlayerMatches: insights.mostActivePlayerMatches,
    mostFrequentPairing: mostFrequentPairingLabel,
    mostFrequentPairingMatches: insights.mostFrequentPairing?.matches || 0
  };

  try {
    window.localStorage.setItem(LOADING_INSIGHTS_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore storage failures
  }
}

function buildLoadingTips(): string[] {
  return [...HARD_BAKED_INTERESTING_STATS, ...BASE_LOADING_TIPS];
}

function renderNextLoadingTip(): void {
  if (!state.loadingTips.length) {
    return;
  }
  if (state.loadingTipIndex >= state.loadingTips.length) {
    state.loadingTipIndex = 0;
  }
  setLoadingTip(state.loadingTips[state.loadingTipIndex]);
  state.loadingTipIndex += 1;
}

function startLoadingTipRotation(): void {
  state.loadingTips = buildLoadingTips();
  state.loadingTipIndex = 0;
  const interestingTips = state.loadingTips.filter(tip => tip.startsWith('Interesting stat:'));
  if (interestingTips.length > 0) {
    const offset = Math.floor(Date.now() / LOADING_TIP_INTERVAL_MS) % interestingTips.length;
    const selected = interestingTips[offset];
    const selectedIndex = state.loadingTips.indexOf(selected);
    showLoadingTipImmediately(selected);
    state.loadingTipIndex = selectedIndex >= 0 ? selectedIndex + 1 : 0;
  } else {
    showLoadingTipImmediately('Interesting stat: Building graph insights now.');
  }

  if (state.loadingTipTimer) {
    window.clearInterval(state.loadingTipTimer);
  }
  state.loadingTipTimer = window.setInterval(() => {
    renderNextLoadingTip();
  }, LOADING_TIP_INTERVAL_MS);
}

function stopLoadingTipRotation(): void {
  if (state.loadingTipTimer) {
    window.clearInterval(state.loadingTipTimer);
    state.loadingTipTimer = null;
  }
  if (state.loadingTipFadeHandle) {
    window.clearTimeout(state.loadingTipFadeHandle);
    state.loadingTipFadeHandle = null;
  }
}

function hideSuggestions(picker: PickerState): void {
  picker.suggestions.hidden = true;
  picker.suggestions.innerHTML = '';
  picker.matches = [];
  picker.activeIndex = -1;
}

function getIdentityLabel(identity: PlayerIdentity): string {
  return identity.name;
}

function buildSearchCandidates(graph: PlayerConnectionsGraph): SearchCandidate[] {
  const identities = Array.from(graph.identities.values()).sort((left, right) => {
    return left.name.localeCompare(right.name) || left.key.localeCompare(right.key);
  });

  const labels = new Set<string>();
  const duplicateCounts = new Map<string, number>();

  return identities.map(identity => {
    const baseLabel = getIdentityLabel(identity);
    let label = baseLabel;
    if (labels.has(label)) {
      const nextCount = (duplicateCounts.get(baseLabel) || 1) + 1;
      duplicateCounts.set(baseLabel, nextCount);
      label = `${baseLabel} (${nextCount})`;
    } else {
      duplicateCounts.set(baseLabel, 1);
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

function renderHopList(
  identities: PlayerIdentity[],
  hops: Array<{
    round: number | null;
    phase: number | null;
    table: number | null;
    tournament: string;
    fromResult: string | null;
    outcomeType: string | null;
  }>
): void {
  if (!elements.resultList) {
    return;
  }

  hops.forEach((hop, index) => {
    const item = document.createElement('li');
    item.className = 'connections-result-item';

    const fromIdentity = identities[index];
    const toIdentity = identities[index + 1];
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
  renderHopList(result.identities, result.hops);
}

function renderFurthestResult(result: FurthestConnectionResult): void {
  if (!elements.resultSection || !elements.resultSummary || !elements.resultList || !elements.resultTitle) {
    return;
  }

  elements.resultSection.hidden = false;
  elements.resultList.innerHTML = '';

  if (result.status === 'not_found') {
    elements.resultTitle.textContent = 'Player not found';
    elements.resultSummary.textContent = 'Player A could not be matched to an indexed identity.';
    return;
  }

  const source = result.identities[0]?.name || 'Player A';
  const target = result.identities[result.identities.length - 1]?.name || source;

  if (result.status === 'same') {
    elements.resultTitle.textContent = 'No outward connection';
    elements.resultSummary.textContent = `${source} has no tracked direct-match chain to another indexed player.`;
    return;
  }

  elements.resultTitle.textContent = 'Furthest connection';
  elements.resultSummary.textContent = `${source}'s furthest reachable player is ${target} at ${result.degree} degree${result.degree === 1 ? '' : 's'} (within ${result.reachableCount.toLocaleString()} reachable players).`;
  renderHopList(result.identities, result.hops);
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
    const signature = pathSignatureFromIdentities(result.identities);
    if (sourceKey && targetKey) {
      state.lastQuery = {
        mode: 'pair',
        sourceKey,
        targetKey,
        seenPathSignatures: new Set<string>([signature])
      };
      setRerollEnabled(true);
    } else {
      clearLastQueryState();
    }
    setNote(`Connection found at degree ${result.degree}.`);
  } else if (result.status === 'same') {
    clearLastQueryState();
    setNote('Selected players resolve to the same identity.');
  } else if (result.status === 'disconnected') {
    clearLastQueryState();
    setNote('No connection found in the current offline dataset.');
  } else {
    clearLastQueryState();
    setNote('Please choose valid players from suggestions.');
  }
}

function handleFindFurthest(): void {
  if (!state.graph || !state.pickerA) {
    return;
  }

  const sourceKey = state.pickerA.selectedKey || resolveIdentityKey(state.pickerA.input.value);
  const result = findFurthestConnectionFrom(state.graph, sourceKey);
  renderFurthestResult(result);

  if (result.status === 'connected') {
    const signature = pathSignatureFromIdentities(result.identities);
    if (sourceKey) {
      state.lastQuery = {
        mode: 'furthest',
        sourceKey,
        seenPathSignatures: new Set<string>([signature])
      };
      setRerollEnabled(true);
    } else {
      clearLastQueryState();
    }
    setNote(`Furthest reachable connection from Player A is degree ${result.degree}.`);
  } else if (result.status === 'same') {
    clearLastQueryState();
    setNote('Player A has no tracked outward connection.');
  } else {
    clearLastQueryState();
    setNote('Please choose a valid Player A from suggestions.');
  }
}

function handleReroll(): void {
  if (!state.graph || !state.lastQuery) {
    setNote('Run a search first, then use re-roll.');
    return;
  }

  const maxAttempts = 30;
  let candidateFound = false;

  if (state.lastQuery.mode === 'pair') {
    let fallback: ConnectionPathResult | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const candidate = findConnectionPath(state.graph, state.lastQuery.sourceKey, state.lastQuery.targetKey, {
        randomizeNeighbors: true,
        rng: Math.random
      });

      if (candidate.status !== 'connected') {
        continue;
      }

      fallback = candidate;
      const signature = pathSignatureFromIdentities(candidate.identities);
      if (state.lastQuery.seenPathSignatures.has(signature)) {
        continue;
      }

      state.lastQuery.seenPathSignatures.add(signature);
      renderResults(candidate);
      setNote(`Re-rolled to another shortest path at degree ${candidate.degree}.`);
      candidateFound = true;
      break;
    }

    if (!candidateFound && fallback && fallback.status === 'connected') {
      renderResults(fallback);
      setNote(`No new route found yet. Showing a valid shortest path at degree ${fallback.degree}.`);
      candidateFound = true;
    }
  } else {
    let fallback: FurthestConnectionResult | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const candidate = findFurthestConnectionFrom(state.graph, state.lastQuery.sourceKey, {
        randomizeNeighbors: true,
        randomizeFarthestTie: true,
        rng: Math.random
      });

      if (candidate.status !== 'connected') {
        continue;
      }

      fallback = candidate;
      const signature = pathSignatureFromIdentities(candidate.identities);
      if (state.lastQuery.seenPathSignatures.has(signature)) {
        continue;
      }

      state.lastQuery.seenPathSignatures.add(signature);
      renderFurthestResult(candidate);
      setNote(`Re-rolled to another furthest path at degree ${candidate.degree}.`);
      candidateFound = true;
      break;
    }

    if (!candidateFound && fallback && fallback.status === 'connected') {
      renderFurthestResult(fallback);
      setNote(`No new furthest route found yet. Showing a valid furthest path at degree ${fallback.degree}.`);
      candidateFound = true;
    }
  }

  if (!candidateFound) {
    setNote('No alternate path available for this query.');
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

function configureActionButtons(): void {
  if (!elements.searchButton) {
    return;
  }

  elements.searchButton.addEventListener('click', () => {
    handleSearch();
  });

  elements.furthestButton?.addEventListener('click', () => {
    handleFindFurthest();
  });

  elements.rerollButton?.addEventListener('click', () => {
    handleReroll();
  });

  setRerollEnabled(false);
}

function updateProgress(progress: {
  phase: 'index' | 'graph';
  completed: number;
  total: number;
  tournament: string;
  participantRows?: number;
  canonicalMatchRows?: number;
  edgesAdded?: number;
  identities?: number;
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
  startLoadingTipRotation();

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
    const insights = computeGraphInterestingStats(graph);
    writeCachedInsights(graph, insights);
    state.graph = graph;
    state.candidates = buildSearchCandidates(graph);
    state.candidateByLabel = new Map(
      state.candidates.map(candidate => [normalizePlayerName(candidate.label), candidate.key])
    );

    initPickers();
    configureActionButtons();

    const componentPct = formatPercent(graph.stats.largestComponentShare);
    const statsText = `Indexed ${graph.stats.identities.toLocaleString()} identities, ${graph.stats.edgesAdded.toLocaleString()} unique match edges, and ${graph.stats.tournamentsDeduped.toLocaleString()} tournaments. Largest cluster: ${graph.stats.largestComponentSize.toLocaleString()} players (${componentPct}) across ${graph.stats.connectedComponents.toLocaleString()} components.`;
    const failureText = graph.stats.partialFailure
      ? ` Partial load warning: ${graph.stats.tournamentsFailed} tournament(s) failed.`
      : '';

    setStats(`${statsText}${failureText}`);
    setNote(
      graph.stats.partialFailure
        ? 'Graph loaded with partial failures.'
        : 'Graph ready. Choose two players, find furthest from Player A, then re-roll for alternates.'
    );

    setProgress('Graph build complete.', 1);
    setAppVisible(true);
  } catch (error) {
    logger.exception('Failed to initialize player connections tool', error);
    setErrorVisible(true, 'Unable to load player connection data right now.');
  } finally {
    stopLoadingTipRotation();
    setLoadingVisible(false);
  }
}

init().catch(error => {
  logger.exception('Unhandled player connections initialization error', error);
  setErrorVisible(true, 'Unable to load player connection data right now.');
  stopLoadingTipRotation();
  setLoadingVisible(false);
});
