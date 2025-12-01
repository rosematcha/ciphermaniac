/**
 * Incidents page renderer
 */

import './utils/buildVersion.js';
import { fetchTournamentsList } from './api.js';
import { logger } from './utils/logger.js';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

const STATUS_DETAILS = {
  yes: { label: 'Yes', description: 'Incident confirmed at this event.' },
  no: { label: 'No', description: 'No incident reported at this event.' },
  pending: {
    label: 'Pending',
    description: 'Investigation pending for this event.'
  }
} as const;

type IncidentStatus = keyof typeof STATUS_DETAILS;

const INCIDENTS_PER_PAGE = 8;

const INCIDENT_OVERRIDES: Record<
  string,
  {
    status: IncidentStatus;
    evidence?: string;
  }
> = {
  '2025-10-25, Regional Lille': {
    status: 'yes',
    evidence: 'https://x.com/LeonardoLatta9/status/1981989975928541429?t=3mpUx0iwnf6jlS79P8Fqhw&s=19'
  },
  '2025-10-11, Regional Milwaukee, WI': {
    status: 'yes',
    evidence: 'https://x.com/Soy_Sauxe/status/1977100274113405403?t=dlJOy6BVnqBt9ibUDHjDYw&s=19'
  },
  '2025-09-20, Regional Pittsburgh, PA': {
    status: 'yes',
    evidence: 'https://x.com/Unboundqueen27/status/1969482210412478847?t=3BBrXXHQNnKQpWFVPyFRvQ&s=19'
  }
};

interface InitOptions {
  listSelector?: string;
  paginationSelector?: string;
  fetchTournaments?: () => Promise<string[]>;
}

export async function initIncidentsPage(options: InitOptions = {}): Promise<void> {
  const {
    listSelector = '#incidentsList',
    paginationSelector = '#incidentsPagination',
    fetchTournaments = fetchTournamentsList
  } = options;

  const listContainer = document.querySelector<HTMLElement>(listSelector);
  const paginationContainer = paginationSelector ? document.querySelector<HTMLElement>(paginationSelector) : null;

  if (!listContainer) {
    logger.warn('Incidents list container not found', { listSelector });
    return;
  }

  listContainer.setAttribute('aria-busy', 'true');
  if (paginationContainer) {
    paginationContainer.classList.add('is-hidden');
    paginationContainer.setAttribute('aria-hidden', 'true');
  }

  try {
    const tournaments = await fetchTournaments();
    const items = collectTournamentEntries(Array.isArray(tournaments) ? tournaments : []);
    initializeIncidentsPagination({
      tournaments: items,
      listContainer,
      paginationContainer
    });
  } catch (error: any) {
    logger.error('Failed to load tournaments list for incidents page', error);
    renderError(listContainer);
    if (paginationContainer) {
      paginationContainer.replaceChildren();
      paginationContainer.classList.add('is-hidden');
      paginationContainer.setAttribute('aria-hidden', 'true');
    }
  } finally {
    listContainer.setAttribute('aria-busy', 'false');
  }
}

function renderTournaments(container: HTMLElement, tournaments: string[]): void {
  container.replaceChildren();

  if (!tournaments.length) {
    const empty = document.createElement('li');
    empty.className = 'incidents-empty';
    empty.textContent = 'No tournaments are available yet.';
    container.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const entry of tournaments) {
    fragment.appendChild(createIncidentRow(entry));
  }

  container.appendChild(fragment);
}

function renderError(container: HTMLElement): void {
  const item = document.createElement('li');
  item.className = 'incidents-error';
  item.textContent = 'Unable to load tournaments. Please try again later.';
  container.replaceChildren(item);
}

function collectTournamentEntries(tournaments: string[]): string[] {
  const merged = new Set(Array.isArray(tournaments) ? tournaments : []);
  for (const key of Object.keys(INCIDENT_OVERRIDES)) {
    merged.add(key);
  }
  return Array.from(merged).sort(compareTournamentEntries);
}

function compareTournamentEntries(entryA: string, entryB: string): number {
  const timeA = extractTournamentTime(entryA);
  const timeB = extractTournamentTime(entryB);

  const hasTimeA = Number.isFinite(timeA);
  const hasTimeB = Number.isFinite(timeB);

  if (hasTimeA && hasTimeB && timeA !== timeB) {
    return timeB - timeA;
  }

  if (hasTimeA && !hasTimeB) {
    return -1;
  }
  if (!hasTimeA && hasTimeB) {
    return 1;
  }

  return String(entryA).localeCompare(String(entryB));
}

function extractTournamentTime(entry: string): number {
  if (typeof entry !== 'string') {
    return Number.NaN;
  }
  const [rawDate] = entry.split(',');
  if (!rawDate) {
    return Number.NaN;
  }
  const date = new Date(rawDate.trim());
  const time = date.getTime();
  return Number.isNaN(time) ? Number.NaN : time;
}

interface PaginationParams {
  tournaments: string[];
  listContainer: HTMLElement;
  paginationContainer: HTMLElement | null;
}

function initializeIncidentsPagination(params: PaginationParams): void {
  const { tournaments, listContainer, paginationContainer } = params;
  const items = Array.isArray(tournaments) ? tournaments : [];
  const perPage = INCIDENTS_PER_PAGE;
  let currentPage = 1;

  const goToPage = (page: number) => {
    const maxPage = Math.max(1, Math.ceil(items.length / perPage) || 1);
    const nextPage = Math.min(Math.max(page, 1), maxPage);
    if (nextPage === currentPage) {
      return;
    }
    currentPage = nextPage;
    render();
  };

  const render = () => {
    const visibleItems = paginate(items, currentPage, perPage);
    renderTournaments(listContainer, visibleItems);
    renderPaginationControls(paginationContainer, currentPage, items.length, perPage, goToPage);
  };

  render();
}

function paginate<T>(items: T[], page: number, perPage: number): T[] {
  const start = (page - 1) * perPage;
  return items.slice(start, start + perPage);
}

function renderPaginationControls(
  container: HTMLElement | null,
  currentPage: number,
  totalItems: number,
  perPage: number,
  onPageChange: (page: number) => void
): void {
  if (!container) {
    return;
  }

  const totalPages = Math.max(1, Math.ceil(totalItems / perPage));

  if (totalPages <= 1) {
    container.replaceChildren();
    container.classList.add('is-hidden');
    container.setAttribute('aria-hidden', 'true');
    return;
  }

  container.classList.remove('is-hidden');
  container.removeAttribute('aria-hidden');
  container.replaceChildren();

  const list = document.createElement('ul');
  list.className = 'pagination';

  for (let i = 1; i <= totalPages; i++) {
    const item = document.createElement('li');
    item.className = i === currentPage ? 'pagination__item pagination__item--active' : 'pagination__item';

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = String(i);
    button.setAttribute('aria-label', `Go to page ${i}`);
    button.addEventListener('click', () => onPageChange(i));

    item.appendChild(button);
    list.appendChild(item);
  }

  container.appendChild(list);
}

function createIncidentRow(entry: string): HTMLLIElement {
  const item = document.createElement('li');
  item.className = 'incidents-row';

  const content = document.createElement('div');
  content.className = 'incidents-row__content';

  const override = INCIDENT_OVERRIDES[entry];
  const status: IncidentStatus = override?.status || 'pending';
  const evidence = override?.evidence || null;

  const [date, event] = entry.split(',');
  const dateElement = document.createElement('div');
  dateElement.className = 'incidents-row__date';
  dateElement.textContent = date?.trim() || 'Unknown date';

  const eventElement = document.createElement('div');
  eventElement.className = 'incidents-row__event';
  eventElement.textContent = event?.trim() || 'Unknown event';

  const badge = document.createElement('div');
  badge.className = `incidents-row__badge incidents-row__badge--${status}`;
  const statusLabel = STATUS_DETAILS[status]?.label || status;
  const statusDescription = STATUS_DETAILS[status]?.description || '';
  badge.textContent = statusLabel;
  badge.title = statusDescription;

  const icon = createStatusIcon(status);
  badge.prepend(icon);

  content.appendChild(dateElement);
  content.appendChild(eventElement);

  item.appendChild(content);
  item.appendChild(badge);

  if (evidence) {
    const evidenceLink = document.createElement('a');
    evidenceLink.href = evidence;
    evidenceLink.target = '_blank';
    evidenceLink.rel = 'noopener noreferrer';
    evidenceLink.className = 'incidents-row__evidence';
    evidenceLink.textContent = 'See evidence';
    item.appendChild(evidenceLink);
  }

  return item;
}

function createStatusIcon(status: IncidentStatus): SVGElement {
  const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('role', 'img');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('status-icon');

  const circle = document.createElementNS(SVG_NAMESPACE, 'circle');
  circle.setAttribute('cx', '12');
  circle.setAttribute('cy', '12');
  circle.setAttribute('r', '10');
  circle.setAttribute('class', 'status-icon__circle');
  svg.appendChild(circle);

  if (status === 'yes') {
    const mark = document.createElementNS(SVG_NAMESPACE, 'path');
    mark.setAttribute('d', 'M8 12.5L11 15.5 17 9');
    mark.setAttribute('class', 'status-icon__mark');
    svg.appendChild(mark);
  } else if (status === 'no') {
    const markA = document.createElementNS(SVG_NAMESPACE, 'line');
    markA.setAttribute('x1', '9');
    markA.setAttribute('y1', '9');
    markA.setAttribute('x2', '15');
    markA.setAttribute('y2', '15');
    markA.setAttribute('class', 'status-icon__mark');

    const markB = document.createElementNS(SVG_NAMESPACE, 'line');
    markB.setAttribute('x1', '15');
    markB.setAttribute('y1', '9');
    markB.setAttribute('x2', '9');
    markB.setAttribute('y2', '15');
    markB.setAttribute('class', 'status-icon__mark');

    svg.appendChild(markA);
    svg.appendChild(markB);
  } else {
    const text = document.createElementNS(SVG_NAMESPACE, 'text');
    text.setAttribute('x', '12');
    text.setAttribute('y', '16');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('class', 'status-icon__mark status-icon__mark--pending');
    text.textContent = '?';
    svg.appendChild(text);
  }

  return svg;
}
