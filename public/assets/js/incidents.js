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
  pending: { label: 'Pending', description: 'Investigation pending for this event.' }
};

const INCIDENTS_PER_PAGE = 8;

const INCIDENT_OVERRIDES = {
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

/**
 * Initialize the incidents page
 * @param {object} [options]
 * @param {string} [options.listSelector]
 * @returns {Promise<void>}
 */
export async function initIncidentsPage(options = {}) {
  const { listSelector = '#incidentsList', paginationSelector = '#incidentsPagination' } = options;

  const listContainer = /** @type {HTMLElement | null} */ (document.querySelector(listSelector));
  const paginationContainer = paginationSelector
    ? /** @type {HTMLElement | null} */ (document.querySelector(paginationSelector))
    : null;

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
    const tournaments = await fetchTournamentsList();
    const items = collectTournamentEntries(Array.isArray(tournaments) ? tournaments : []);
    initializeIncidentsPagination({
      tournaments: items,
      listContainer,
      paginationContainer
    });
  } catch (error) {
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

/**
 * Render tournaments list
 * @param {HTMLElement} container
 * @param {string[]} tournaments
 */
function renderTournaments(container, tournaments) {
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

/**
 * Render error state
 * @param {HTMLElement} container
 */
function renderError(container) {
  const item = document.createElement('li');
  item.className = 'incidents-error';
  item.textContent = 'Unable to load tournaments. Please try again later.';
  container.replaceChildren(item);
}

/**
 * Collect tournaments including override-only entries and sort them
 * @param {string[]} tournaments
 * @returns {string[]}
 */
function collectTournamentEntries(tournaments) {
  const merged = new Set(Array.isArray(tournaments) ? tournaments : []);
  for (const key of Object.keys(INCIDENT_OVERRIDES)) {
    merged.add(key);
  }
  return Array.from(merged).sort(compareTournamentEntries);
}

/**
 * Compare tournaments by date (desc), then lexicographically
 * @param {string} entryA
 * @param {string} entryB
 * @returns {number}
 */
function compareTournamentEntries(entryA, entryB) {
  const timeA = extractTournamentTime(entryA);
  const timeB = extractTournamentTime(entryB);

  const hasTimeA = Number.isFinite(timeA);
  const hasTimeB = Number.isFinite(timeB);

  if (hasTimeA && hasTimeB && timeA !== timeB) {
    return timeB - timeA; // newest first
  }

  if (hasTimeA && !hasTimeB) {
    return -1;
  }
  if (!hasTimeA && hasTimeB) {
    return 1;
  }

  return String(entryA).localeCompare(String(entryB));
}

/**
 * Parse a tournament entry's leading date portion
 * @param {string} entry
 * @returns {number}
 */
function extractTournamentTime(entry) {
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

/**
 * Setup pagination handling for incidents list
 * @param {object} params
 * @param {string[]} params.tournaments
 * @param {HTMLElement} params.listContainer
 * @param {HTMLElement | null} params.paginationContainer
 */
function initializeIncidentsPagination(params) {
  const { tournaments, listContainer, paginationContainer } = params;
  const items = Array.isArray(tournaments) ? tournaments : [];
  const perPage = INCIDENTS_PER_PAGE;
  let currentPage = 1;

  function goToPage(page) {
    const maxPage = Math.max(1, Math.ceil(items.length / perPage) || 1);
    const nextPage = Math.min(Math.max(page, 1), maxPage);
    if (nextPage === currentPage) {
      return;
    }
    currentPage = nextPage;
    render();
  }

  function render() {
    const visibleItems = paginate(items, currentPage, perPage);
    renderTournaments(listContainer, visibleItems);
    renderPagination(paginationContainer, {
      currentPage,
      perPage,
      total: items.length,
      onPageChange: goToPage
    });
  }

  render();
}

/**
 * Utility to paginate an array
 * @param {string[]} items
 * @param {number} page
 * @param {number} perPage
 * @returns {string[]}
 */
function paginate(items, page, perPage) {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  if (perPage <= 0) {
    return items.slice();
  }

  const startIndex = Math.max(0, (page - 1) * perPage);
  return items.slice(startIndex, startIndex + perPage);
}

/**
 * Render pagination controls
 * @param {HTMLElement | null} container
 * @param {{ currentPage: number, perPage: number, total: number, onPageChange: (page: number) => void }} options
 */
function renderPagination(container, options) {
  if (!container) {
    return;
  }

  const { currentPage, perPage, total, onPageChange } = options;
  const totalPages = perPage > 0 ? Math.ceil(total / perPage) : 0;

  container.replaceChildren();

  if (!total || totalPages <= 1) {
    container.classList.add('is-hidden');
    container.setAttribute('aria-hidden', 'true');
    return;
  }

  container.classList.remove('is-hidden');
  container.removeAttribute('aria-hidden');

  const previousButton = createPaginationButton('Previous', currentPage > 1, () => {
    if (typeof onPageChange === 'function') {
      onPageChange(currentPage - 1);
    }
  });

  const status = document.createElement('span');
  status.className = 'pagination-status';
  status.textContent = `Page ${currentPage} of ${totalPages}`;

  const nextButton = createPaginationButton('Next', currentPage < totalPages, () => {
    if (typeof onPageChange === 'function') {
      onPageChange(currentPage + 1);
    }
  });

  container.append(previousButton, status, nextButton);
}

/**
 * Create a pagination button element
 * @param {string} label
 * @param {boolean} isEnabled
 * @param {() => void} onClick
 * @returns {HTMLButtonElement}
 */
function createPaginationButton(label, isEnabled, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'pagination-btn';
  button.textContent = label;

  if (!isEnabled) {
    button.disabled = true;
    return button;
  }

  button.addEventListener('click', () => {
    onClick();
  });

  return button;
}

/**
 * Create incident row
 * @param {string} entry
 * @returns {HTMLLIElement}
 */
function createIncidentRow(entry) {
  const { status, evidence } = resolveIncidentStatus(entry);
  const details = STATUS_DETAILS[status] ?? STATUS_DETAILS.pending;

  const item = document.createElement('li');
  item.className = 'incident-row';

  const info = document.createElement('div');
  info.className = 'incident-info';

  const { name, dateLabel } = parseTournamentEntry(entry);

  const nameElement = document.createElement('div');
  nameElement.className = 'incident-name';
  nameElement.textContent = name;

  const dateElement = document.createElement('div');
  dateElement.className = 'incident-date';
  if (dateLabel) {
    dateElement.textContent = dateLabel;
  }

  info.appendChild(nameElement);
  if (dateLabel) {
    info.appendChild(dateElement);
  }

  const statusWrapper = document.createElement('div');
  statusWrapper.className = 'incident-status';
  statusWrapper.dataset.status = status;
  statusWrapper.setAttribute('aria-label', details.description);

  const statusText = document.createElement('span');
  statusText.className = 'status-label status-text';
  statusText.textContent = details.label;

  const statusIcon = createStatusIcon(status);

  if (status === 'yes' && evidence) {
    const evidenceLink = createEvidenceLink(evidence);
    evidenceLink.appendChild(statusText);
    evidenceLink.appendChild(createEvidenceIcon());
    statusWrapper.appendChild(evidenceLink);
    statusWrapper.appendChild(statusIcon);
  } else {
    statusWrapper.appendChild(statusText);
    statusWrapper.appendChild(statusIcon);

    if (evidence) {
      const evidenceLink = createEvidenceLink(evidence);
      evidenceLink.appendChild(createEvidenceIcon());
      statusWrapper.appendChild(evidenceLink);
    }
  }

  item.appendChild(info);
  item.appendChild(statusWrapper);
  return item;
}

/**
 * Parse tournament entry into structured parts
 * @param {string} entry
 * @returns {{ dateLabel: string, name: string }}
 */
function parseTournamentEntry(entry) {
  if (typeof entry !== 'string' || entry.trim() === '') {
    return { name: 'Unknown Tournament', dateLabel: '' };
  }

  const parts = entry
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);

  if (!parts.length) {
    return { name: entry, dateLabel: '' };
  }

  if (parts.length === 1) {
    return { name: parts[0], dateLabel: '' };
  }

  const [dateRaw, ...nameParts] = parts;
  const name = nameParts.join(', ');
  const formattedDate = formatDate(dateRaw);

  return {
    name: name || dateRaw,
    dateLabel: formattedDate || dateRaw
  };
}

/**
 * Format ISO-like date into display value
 * @param {string} value
 * @returns {string}
 */
function formatDate(value) {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(date);
}

/**
 * Resolve incident status from overrides
 * @param {string} entry
 * @returns {{ status: keyof typeof STATUS_DETAILS, evidence: string | null }}
 */
function resolveIncidentStatus(entry) {
  const override = INCIDENT_OVERRIDES[entry];
  const overrideStatus = override?.status || 'no';
  const status = STATUS_DETAILS[overrideStatus] ? overrideStatus : 'pending';

  return {
    status,
    evidence: typeof override?.evidence === 'string' ? override.evidence : null
  };
}

/**
 * Create evidence link element
 * @param {string} url
 * @returns {HTMLAnchorElement}
 */
function createEvidenceLink(url) {
  const link = document.createElement('a');
  link.className = 'incident-evidence';
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

/**
 * Create SVG evidence icon
 * @returns {SVGElement}
 */
function createEvidenceIcon() {
  const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'evidence-icon');

  const path = document.createElementNS(SVG_NAMESPACE, 'path');
  path.setAttribute('d', 'M14 3h7v7M10 14L21 3M21 10v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h10');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');

  svg.appendChild(path);
  return svg;
}

/**
 * Create status icon
 * @param {keyof typeof STATUS_DETAILS} status
 * @returns {SVGElement}
 */
function createStatusIcon(status) {
  const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', `status-icon status-icon--${status}`);
  svg.setAttribute('aria-hidden', 'true');

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
