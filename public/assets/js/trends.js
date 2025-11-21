import './utils/buildVersion.js';
import { fetchTrendReport, ONLINE_META_NAME } from './api.js';
import { fetchAllDecks } from './utils/clientSideFiltering.js';
import { buildCardTrendDataset, buildTrendDataset } from './utils/trendAggregator.js';
import { logger } from './utils/logger.js';

const palette = ['#6aa3ff', '#ff6b6b', '#3ad27a', '#f1c40f', '#9b59b6', '#ff9f43'];

const elements = {
  list: document.getElementById('trends-list'),
  loadingMeta: document.getElementById('trends-loading'),
  loadingArch: document.getElementById('trends-loading-arch'),
  summary: document.getElementById('trend-summary'),
  minSlider: /** @type {HTMLInputElement|null} */ (document.getElementById('trend-min-tournaments')),
  minValue: document.getElementById('trend-min-value'),
  status: document.getElementById('trend-status'),
  refresh: document.getElementById('trend-refresh'),
  metaChart: document.getElementById('trend-meta-chart'),
  metaPanel: document.getElementById('trend-meta'),
  archetypePanel: document.getElementById('trend-archetypes'),
  legend: document.getElementById('trend-legend'),
  movers: document.getElementById('trend-movers'),
  cardMovers: document.getElementById('trend-card-movers'),
  modeMeta: document.getElementById('trend-mode-meta'),
  modeArchetypes: document.getElementById('trend-mode-archetypes')
};

const state = {
  trendData: /** @type {null|{ series: any[], tournaments: any[], generatedAt?: string, minAppearances?: number, windowStart?: string|null, windowEnd?: string|null }} */ (null),
  isLoading: false,
  isHydrating: false,
  minAppearances: 3,
  mode: 'meta'
};

function setStatus(message) {
  if (elements.status) {
    elements.status.textContent = message || '';
  }
}

function setLoadingMeta(isLoading) {
  if (!elements.loadingMeta) {
    return;
  }
  elements.loadingMeta.style.display = isLoading ? 'block' : 'none';
}

function setLoadingArchetypes(isLoading) {
  if (!elements.loadingArch) {
    return;
  }
  elements.loadingArch.style.display = isLoading ? 'block' : 'none';
}

function setLoading(isLoading) {
  state.isLoading = isLoading;
  setLoadingMeta(isLoading);
  setLoadingArchetypes(isLoading);
}

function formatDate(value) {
  if (!value) {
    return 'unknown date';
  }
  const date = new Date(value);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatPercent(value) {
  const pct = Math.round(value * 10) / 10;
  return `${pct.toFixed(pct % 1 === 0 ? 0 : 1)}%`;
}

function buildMetaLines(trendData, topN = 5) {
  if (!trendData || !Array.isArray(trendData.series) || !Array.isArray(trendData.tournaments)) {
    return null;
  }
  const tournaments = [...trendData.tournaments].sort(
    (a, b) => Date.parse(a.date || 0) - Date.parse(b.date || 0)
  );
  if (!tournaments.length) {
    return null;
  }
  const topSeries = trendData.series.slice(0, topN);
  const ids = tournaments.map(t => t.id);

  const lines = topSeries.map((entry, index) => {
    const points = ids.map(tid => {
      const found = entry.timeline.find(item => item.tournamentId === tid);
      return found ? (Number(found.share) || 0) : 0;
    });
    const first = points[0] || 0;
    const last = points[points.length - 1] || 0;
    return {
      name: entry.displayName || entry.base,
      color: palette[index % palette.length],
      points,
      latest: last,
      delta: Math.round((last - first) * 10) / 10
    };
  });

  // Aggregate "Other" if there are more archetypes
  if (trendData.series.length > topN) {
    const otherPoints = ids.map((tid, idx) => {
      const topTotal = lines.reduce((sum, line) => sum + (line.points[idx] || 0), 0);
      return Math.max(0, Math.round((100 - topTotal) * 10) / 10);
    });
    lines.push({
      name: 'Other',
      color: '#7c86a8',
      points: otherPoints,
      latest: otherPoints[otherPoints.length - 1] || 0,
      delta: Math.round((otherPoints[otherPoints.length - 1] - otherPoints[0]) * 10) / 10
    });
  }

  return { tournaments, lines };
}

function findMovers(lines) {
  if (!Array.isArray(lines) || !lines.length) {
    return { rising: [], falling: [] };
  }
  const sorted = [...lines].filter(line => line.name !== 'Other');
  sorted.sort((a, b) => b.delta - a.delta);
  return {
    rising: sorted.slice(0, 3),
    falling: [...sorted].sort((a, b) => a.delta - b.delta).slice(0, 3)
  };
}

function renderLegend(lines) {
  if (!elements.legend) {
    return;
  }
  elements.legend.innerHTML = '';
  if (!lines || !lines.length) {
    return;
  }
  lines.forEach(line => {
    const item = document.createElement('div');
    item.className = 'legend-item';
    const swatch = document.createElement('span');
    swatch.className = 'legend-swatch';
    swatch.style.backgroundColor = line.color;
    const label = document.createElement('span');
    label.textContent = line.name;
    const value = document.createElement('span');
    value.className = 'legend-value';
    const sign = line.delta > 0 ? '+' : '';
    value.textContent = `${formatPercent(line.latest)} (${sign}${line.delta.toFixed(Math.abs(line.delta) % 1 === 0 ? 0 : 1)}%)`;
    item.appendChild(swatch);
    item.appendChild(label);
    item.appendChild(value);
    elements.legend.appendChild(item);
  });
}

function renderMovers(lines) {
  if (!elements.movers) {
    return;
  }
  elements.movers.innerHTML = '';
  if (!lines || !lines.length) {
    return;
  }
  const { rising, falling } = findMovers(lines);
  const buildGroup = (title, items, direction) => {
    const group = document.createElement('div');
    group.className = 'movers-group';
    const heading = document.createElement('h3');
    heading.textContent = title;
    group.appendChild(heading);
    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'muted small';
      empty.textContent = 'No changes yet.';
      group.appendChild(empty);
      return group;
    }
    const list = document.createElement('ul');
    list.className = 'movers-list';
    items.forEach(item => {
      const li = document.createElement('li');
      const sign = item.delta > 0 ? '+' : '';
      li.innerHTML = `
        <span class="dot" style="background:${item.color}"></span>
        <span class="name">${item.name}</span>
        <span class="perc">${formatPercent(item.latest)}</span>
        <span class="delta ${direction}">${sign}${item.delta.toFixed(Math.abs(item.delta) % 1 === 0 ? 0 : 1)}%</span>
      `;
      list.appendChild(li);
    });
    group.appendChild(list);
    return group;
  };

  elements.movers.appendChild(buildGroup('Rising', rising, 'up'));
  elements.movers.appendChild(buildGroup('Cooling', falling, 'down'));
}

function renderCardMovers(cardTrends) {
  if (!elements.cardMovers) {
    return;
  }
  elements.cardMovers.innerHTML = '';
  if (!cardTrends || (!cardTrends.rising?.length && !cardTrends.falling?.length)) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'Card movement will appear once enough tournaments are available.';
    elements.cardMovers.appendChild(empty);
    return;
  }
  const buildGroup = (title, list, direction) => {
    const group = document.createElement('div');
    group.className = 'movers-group';
    const heading = document.createElement('h3');
    heading.textContent = title;
    group.appendChild(heading);
    const items = Array.isArray(list) ? list.slice(0, 6) : [];
    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'muted small';
      empty.textContent = 'No data yet.';
      group.appendChild(empty);
      return group;
    }
    const ul = document.createElement('ul');
    ul.className = 'movers-list';
    items.forEach(item => {
      const li = document.createElement('li');
      const deltaSign = item.delta > 0 ? '+' : '';
      const idLabel =
        item.set && item.number ? ` (${item.set} ${item.number})` : '';
      li.innerHTML = `
        <span class="dot"></span>
        <span class="name">${item.name}${idLabel}</span>
        <span class="perc">${formatPercent(item.endShare || item.currentShare || 0)}</span>
        <span class="delta ${direction}">${deltaSign}${item.delta?.toFixed(Math.abs(item.delta) % 1 === 0 ? 0 : 1)}%</span>
      `;
      ul.appendChild(li);
    });
    group.appendChild(ul);
    return group;
  };

  elements.cardMovers.appendChild(buildGroup('Cards rising', cardTrends.rising, 'up'));
  elements.cardMovers.appendChild(buildGroup('Cards cooling', cardTrends.falling, 'down'));
}
function deriveTournamentsFromDecks(decks) {
  const map = new Map();
  (Array.isArray(decks) ? decks : []).forEach(deck => {
    const tournamentId = deck?.tournamentId;
    if (!tournamentId) {
      return;
    }
    if (!map.has(tournamentId)) {
      map.set(tournamentId, {
        id: tournamentId,
        name: deck?.tournamentName || 'Unknown Tournament',
        date: deck?.tournamentDate || null,
        players: deck?.tournamentPlayers || null,
        format: deck?.tournamentFormat || null,
        platform: deck?.tournamentPlatform || null,
        organizer: deck?.tournamentOrganizer || null
      });
    }
  });
  return Array.from(map.values()).sort((a, b) => Date.parse(a.date || 0) - Date.parse(b.date || 0));
}

function renderSummary() {
  if (!elements.summary || !state.trendData) {
    return;
  }
  const archetypes = state.trendData.series?.length || 0;
  const tournaments = state.trendData.tournaments?.length || 0;
  const lastUpdated = state.trendData.generatedAt
    ? new Date(state.trendData.generatedAt).toLocaleString()
    : 'n/a';
  const firstDate = state.trendData.windowStart || state.trendData.tournaments?.[0]?.date;
  const lastDate = state.trendData.windowEnd || state.trendData.tournaments?.at(-1)?.date;
  const windowLabel = firstDate && lastDate ? `${formatDate(firstDate)} - ${formatDate(lastDate)}` : 'recent events';

  elements.summary.textContent = `Tracking ${archetypes} archetypes across ${tournaments} tournaments (${windowLabel}). Last updated ${lastUpdated}.`;
}

function updateMinSliderBounds() {
  if (!elements.minSlider || !elements.minValue) {
    return;
  }
  const tournamentCount = state.trendData?.tournaments?.length || Number(elements.minSlider.max) || 8;
  const max = Math.max(1, tournamentCount);
  elements.minSlider.max = String(max);
  if (state.minAppearances > max) {
    state.minAppearances = max;
  }
  elements.minSlider.value = String(state.minAppearances);
  elements.minValue.textContent = `${state.minAppearances}+`;
}

function buildSparkline(timeline) {
  const width = 220;
  const height = 56;
  const stroke = '#3b5bdb';
  const fill = 'rgba(59, 91, 219, 0.1)';
  const shares = timeline.map(entry => entry.share || 0);
  const maxShare = Math.max(...shares, 1);
  const count = timeline.length;

  const points = timeline.map((entry, index) => {
    const x = count === 1 ? width / 2 : (index / (count - 1)) * width;
    const y = height - (entry.share / maxShare) * height;
    return `${x},${y}`;
  });

  const areaPoints = [`0,${height}`, ...points, `${width},${height}`].join(' ');

  return `
    <svg class="sparkline" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
      <polyline fill="${fill}" stroke="none" points="${areaPoints}"></polyline>
      <polyline fill="none" stroke="${stroke}" stroke-width="2" points="${points.join(' ')}"></polyline>
    </svg>
  `;
}

function renderSeriesCard(series) {
  const card = document.createElement('article');
  card.className = 'trend-card';

  const header = document.createElement('header');
  header.className = 'trend-card__header';

  const title = document.createElement('h3');
  title.textContent = series.displayName || series.base;
  header.appendChild(title);

  const stats = document.createElement('div');
  stats.className = 'trend-card__stats';
  const appearances = document.createElement('div');
  appearances.className = 'trend-card__stat';
  appearances.textContent = `${series.appearances} tournaments`;

  const avg = document.createElement('div');
  avg.className = 'trend-card__stat';
  avg.textContent = `Avg share ${formatPercent(series.avgShare)}`;

  const delta = document.createElement('div');
  delta.className = 'trend-card__stat';
  const firstShare = series.timeline[0]?.share || 0;
  const latestShare = series.timeline[series.timeline.length - 1]?.share || 0;
  const change = Math.round((latestShare - firstShare) * 10) / 10;
  const sign = change > 0 ? '+' : '';
  delta.textContent = `Change ${sign}${change.toFixed(Math.abs(change) % 1 === 0 ? 0 : 1)}%`;

  stats.appendChild(appearances);
  stats.appendChild(avg);
  stats.appendChild(delta);

  const chart = document.createElement('div');
  chart.className = 'trend-card__chart';
  chart.innerHTML = buildSparkline(series.timeline);

  const timelineLabel = document.createElement('div');
  timelineLabel.className = 'trend-card__timeline';
  const firstLabel = series.timeline[0] ? formatDate(series.timeline[0].date) : '';
  const lastLabel = series.timeline[series.timeline.length - 1]
    ? formatDate(series.timeline[series.timeline.length - 1].date)
    : '';
  timelineLabel.textContent = `${firstLabel} -> ${lastLabel}`;

  card.appendChild(header);
  card.appendChild(stats);
  card.appendChild(chart);
  card.appendChild(timelineLabel);

  return card;
}

function renderMetaChart() {
  if (!elements.metaChart) {
    return;
  }
  elements.metaChart.innerHTML = '';
  const meta = buildMetaLines(state.trendData, 5);
  if (!meta || !meta.lines?.length) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = 'Not enough data to show meta trends yet.';
    elements.metaChart.appendChild(empty);
    return;
  }

  const width = 720;
  const height = 260;
  const padX = 36;
  const padY = 28;
  const contentWidth = width - padX * 2;
  const contentHeight = height - padY * 2;
  const maxShare = 100;
  const count = meta.tournaments.length;

  const xForIndex = idx => (count === 1 ? contentWidth / 2 : (idx / (count - 1)) * contentWidth) + padX;
  const yForShare = share => height - padY - (Math.min(share, maxShare) / maxShare) * contentHeight;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '260');
  svg.setAttribute('role', 'img');
  svg.classList.add('meta-svg');

  // grid lines
  [25, 50, 75, 100].forEach(level => {
    const y = yForShare(level);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', `${padX}`);
    line.setAttribute('x2', `${width - padX}`);
    line.setAttribute('y1', `${y}`);
    line.setAttribute('y2', `${y}`);
    line.setAttribute('stroke', 'rgba(124,134,168,0.2)');
    line.setAttribute('stroke-width', '1');
    svg.appendChild(line);

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', `${padX - 10}`);
    label.setAttribute('y', `${y + 4}`);
    label.setAttribute('fill', '#7c86a8');
    label.setAttribute('font-size', '11');
    label.textContent = `${level}%`;
    label.setAttribute('text-anchor', 'end');
    svg.appendChild(label);
  });

  meta.lines.forEach(line => {
    const points = line.points.map((share, idx) => `${xForIndex(idx)},${yForShare(share)}`).join(' ');
    const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    polyline.setAttribute('fill', 'none');
    polyline.setAttribute('stroke', line.color);
    polyline.setAttribute('stroke-width', '2.5');
    polyline.setAttribute('points', points);
    polyline.setAttribute('stroke-linecap', 'round');
    svg.appendChild(polyline);
  });

  // x-axis labels
  meta.tournaments.forEach((t, idx) => {
    const x = xForIndex(idx);
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', `${x}`);
    label.setAttribute('y', `${height - 6}`);
    label.setAttribute('fill', '#7c86a8');
    label.setAttribute('font-size', '11');
    label.setAttribute('text-anchor', 'middle');
    label.textContent = formatDate(t.date);
    svg.appendChild(label);
  });

  elements.metaChart.appendChild(svg);
  renderLegend(meta.lines);
  renderMovers(meta.lines);
}

function renderList() {
  if (!elements.list) {
    return;
  }
  elements.list.innerHTML = '';

  if (!state.trendData) {
    return;
  }

  const filtered = (state.trendData.series || []).filter(
    item => item.appearances >= state.minAppearances
  );

  if (!filtered.length) {
    const empty = document.createElement('div');
    empty.className = 'trend-empty';
    empty.textContent = 'No archetypes meet the current filters yet.';
    elements.list.appendChild(empty);
    return;
  }

  filtered.forEach(series => {
    const card = renderSeriesCard(series);
    elements.list.appendChild(card);
  });
}

function setMode(mode) {
  state.mode = mode;
  if (elements.modeMeta && elements.modeArchetypes) {
    elements.modeMeta.classList.toggle('is-active', mode === 'meta');
    elements.modeArchetypes.classList.toggle('is-active', mode === 'archetypes');
  }
  if (elements.metaPanel) {
    elements.metaPanel.hidden = mode !== 'meta';
  }
  if (elements.archetypePanel) {
    elements.archetypePanel.hidden = mode !== 'archetypes';
  }
}

async function hydrateFromDecks() {
  if (!state.trendData) {
    return;
  }
  try {
    state.isHydrating = true;
    setStatus('Recomputing from decks...');
    const decks = await fetchAllDecks(ONLINE_META_NAME);
    const tournaments =
      state.trendData.tournaments && state.trendData.tournaments.length
        ? state.trendData.tournaments
        : deriveTournamentsFromDecks(decks);
    const recomputed = buildTrendDataset(decks, tournaments, {
      minAppearances: 1,
      windowStart: state.trendData.windowStart,
      windowEnd: state.trendData.windowEnd
    });
    const cardTrends = buildCardTrendDataset(decks, tournaments, { minAppearances: 2 });
    state.trendData = { ...recomputed, cardTrends };
    updateMinSliderBounds();
    setStatus('Recomputed from latest decks');
    renderSummary();
    renderMetaChart();
    renderCardMovers(state.trendData.cardTrends || null);
    renderList();
  } catch (error) {
    logger.error('Failed to recompute trends from decks', { message: error?.message || error });
    setStatus('Could not recompute from decks');
  } finally {
    state.isHydrating = false;
  }
}

function bindControls() {
  if (elements.minSlider && elements.minValue) {
    const setMinValue = value => {
      elements.minValue.textContent = `${value}+`;
    };
    setMinValue(state.minAppearances);
    elements.minSlider.value = String(state.minAppearances);
    elements.minSlider.addEventListener('input', event => {
      const value = Number((event.target && event.target.value) || state.minAppearances);
      state.minAppearances = Math.max(1, value);
      setMinValue(state.minAppearances);
      renderList();
    });
  }

  if (elements.refresh) {
    elements.refresh.addEventListener('click', () => {
      if (state.isHydrating) {
        return;
      }
      hydrateFromDecks();
    });
  }

  if (elements.modeMeta) {
    elements.modeMeta.addEventListener('click', () => {
      setMode('meta');
    });
  }
  if (elements.modeArchetypes) {
    elements.modeArchetypes.addEventListener('click', () => {
      setMode('archetypes');
    });
  }
}

async function init() {
  if (state.isLoading) {
    return;
  }
  setLoading(true);
  try {
    const payload = await fetchTrendReport(ONLINE_META_NAME);
    state.trendData = payload;
    updateMinSliderBounds();
    renderSummary();
    renderMetaChart();
    renderCardMovers(state.trendData.cardTrends || null);
    renderList();
    setStatus(`Showing pre-generated trends for ${ONLINE_META_NAME}`);
  } catch (error) {
    logger.warn('Failed to load pre-generated trends, falling back to decks', {
      message: error?.message || error
    });
    setStatus('Falling back to deck data...');
    try {
      const decks = await fetchAllDecks(ONLINE_META_NAME);
      const fallbackTournaments = deriveTournamentsFromDecks(decks);
      const archetypeTrends = buildTrendDataset(decks, fallbackTournaments, { minAppearances: 1 });
      const cardTrends = buildCardTrendDataset(decks, fallbackTournaments, { minAppearances: 2 });
      state.trendData = { ...archetypeTrends, cardTrends };
      updateMinSliderBounds();
      renderSummary();
      renderMetaChart();
      renderCardMovers(state.trendData.cardTrends || null);
      renderList();
      setStatus('Using live deck data');
    } catch (fallbackError) {
      logger.error('Failed to load any trend data', {
        message: fallbackError?.message || fallbackError
      });
      setStatus('Unable to load trend data right now.');
    }
  } finally {
    setLoading(false);
  }
}

bindControls();
setMode('meta');
init();
