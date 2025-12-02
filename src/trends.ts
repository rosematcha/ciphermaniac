/* eslint-disable id-length, no-param-reassign, no-unused-vars */
import './utils/buildVersion.js';
import { fetchTrendReport, ONLINE_META_NAME } from './api.js';
import { fetchAllDecks } from './utils/clientSideFiltering.js';
import { buildCardTrendDataset, buildTrendDataset } from './utils/trendAggregator.js';
import { logger } from './utils/logger.js';

const palette = ['#6aa3ff', '#ff6b6b', '#3ad27a', '#f1c40f', '#9b59b6', '#ff9f43'];
const TRENDS_SOURCE = 'Trends - Last 30 Days';

const elements = {
  list: document.getElementById('trends-list'),
  loadingMeta: document.getElementById('trends-loading'),
  loadingArch: document.getElementById('trends-loading-arch'),
  summary: document.getElementById('trend-summary'),
  minSlider: document.getElementById('trend-min-tournaments') as HTMLInputElement | null,
  minValue: document.getElementById('trend-min-value'),
  status: document.getElementById('trend-status'),
  refresh: document.getElementById('trend-refresh'),
  metaChart: document.getElementById('trend-meta-chart'),
  metaPanel: document.getElementById('trend-meta'),
  archetypePanel: document.getElementById('trend-archetypes'),
  legend: document.getElementById('trend-legend'),
  metaRange: document.getElementById('trend-meta-range'),
  movers: document.getElementById('trend-movers'),
  cardMovers: document.getElementById('trend-card-movers'),
  modeMeta: document.getElementById('trend-mode-meta'),
  modeArchetypes: document.getElementById('trend-mode-archetypes')
};

const state = {
  trendData:
    /** @type {null|{ series: any[], tournaments: any[], generatedAt?: string, minAppearances?: number, windowStart?: string|null, windowEnd?: string|null }} */ (
      null
    ),
  cardTrends: null,
  suggestions: null,
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

function smoothSeries(series, window = 3) {
  if (!Array.isArray(series) || series.length === 0) {
    return series;
  }
  const w = Math.max(1, window);
  const result = [];
  for (let i = 0; i < series.length; i += 1) {
    const slice = series.slice(Math.max(0, i - Math.floor(w / 2)), Math.min(series.length, i + Math.ceil(w / 2) + 1));
    const avg = slice.reduce((sum, point) => sum + (point.share || 0), 0) / slice.length;
    result.push({ ...series[i], share: avg });
  }
  return result;
}

function binDaily(timeline) {
  const byDay = new Map();
  (timeline || []).forEach(point => {
    if (!point?.date) {
      return;
    }
    const day = point.date.split('T')[0];
    const total = Number(point.totalDecks || point.total || 0);
    const share = Number(point.share) || 0;
    if (!byDay.has(day)) {
      byDay.set(day, { weighted: 0, decks: 0 });
    }
    const entry = byDay.get(day);
    entry.weighted += share * (total || 1);
    entry.decks += total || 1;
  });
  return Array.from(byDay.entries())
    .map(([date, val]) => ({
      date,
      share: val.decks ? val.weighted / val.decks : 0
    }))
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

function buildMetaLines(trendData, topN = 5) {
  if (!trendData || !Array.isArray(trendData.series) || !Array.isArray(trendData.tournaments)) {
    return null;
  }

  const seriesWithBins = trendData.series.slice(0, topN).map((entry, index) => {
    const daily = binDaily(entry.timeline || []);
    const smoothed = smoothSeries(daily, 3);
    return { ...entry, daily: smoothed, color: palette[index % palette.length] };
  });

  if (!seriesWithBins.length) {
    return null;
  }

  const timelineDates = Array.from(
    new Set<string>(seriesWithBins.flatMap(entry => entry.daily.map(pt => String(pt.date || ''))))
  ).filter(Boolean);

  timelineDates.sort((a, b) => Date.parse(a) - Date.parse(b));

  const lines = seriesWithBins.map(entry => {
    const points = timelineDates.map(d => {
      const found = entry.daily.find(pt => pt.date === d);
      return found ? found.share : 0;
    });
    const startAvg =
      points.slice(0, Math.max(1, Math.ceil(points.length * 0.3))).reduce((a, b) => a + b, 0) /
      Math.max(1, Math.ceil(points.length * 0.3));
    const recentAvg =
      points.slice(-Math.max(1, Math.ceil(points.length * 0.3))).reduce((a, b) => a + b, 0) /
      Math.max(1, Math.ceil(points.length * 0.3));
    const delta = Math.round((recentAvg - startAvg) * 10) / 10;
    return {
      name: entry.displayName || entry.base,
      color: entry.color,
      points,
      latest: points.at(-1) || 0,
      delta
    };
  });

  return { dates: timelineDates, lines };
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

function renderCardMovers(suggestions, cardTrends) {
  if (!elements.cardMovers) {
    return;
  }
  elements.cardMovers.innerHTML = '';
  const risingList =
    (suggestions?.onTheRise && suggestions.onTheRise.length && suggestions.onTheRise) || cardTrends?.rising || [];
  const fallingList =
    (suggestions?.choppedAndWashed && suggestions.choppedAndWashed.length && suggestions.choppedAndWashed) ||
    cardTrends?.falling ||
    [];

  if (!risingList.length && !fallingList.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'Card movement will appear once enough tournaments are available.';
    elements.cardMovers.appendChild(empty);
    return;
  }
  const normalizeCard = item => {
    const latest =
      item.recentAvg ?? item.latest ?? item.currentShare ?? item.endShare ?? item.startShare ?? item.avgShare ?? 0;
    // Clamp delta so it doesn't exceed plausible usage bounds
    const rawDelta = item.deltaAbs ?? item.delta ?? 0;
    const delta = Math.max(Math.min(rawDelta, latest), -100);
    return {
      name: item.name,
      set: item.set || null,
      number: item.number || null,
      archetype: item.archetype || null,
      latest,
      delta
    };
  };

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
    items.forEach(raw => {
      const item = normalizeCard(raw);
      const li = document.createElement('li');
      const deltaSign = item.delta > 0 ? '+' : '';
      const idLabel = item.set && item.number ? ` (${item.set} ${item.number})` : '';
      li.innerHTML = `
        <span class="dot"></span>
        <span class="name">${item.name}${idLabel}</span>
        <span class="perc">${formatPercent(item.latest || 0)}</span>
        <span class="delta ${direction}">${deltaSign}${item.delta?.toFixed(Math.abs(item.delta) % 1 === 0 ? 0 : 1)}%</span>
      `;
      ul.appendChild(li);
    });
    group.appendChild(ul);
    return group;
  };

  elements.cardMovers.appendChild(buildGroup('Cards rising', risingList, 'up'));
  elements.cardMovers.appendChild(buildGroup('Cards cooling', fallingList, 'down'));
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
  const lastUpdated = state.trendData.generatedAt ? new Date(state.trendData.generatedAt).toLocaleString() : 'n/a';
  const firstDate = state.trendData.windowStart || state.trendData.tournaments?.[0]?.date;
  const lastDate = state.trendData.windowEnd || state.trendData.tournaments?.at(-1)?.date;
  const windowLabel = firstDate && lastDate ? `${formatDate(firstDate)} - ${formatDate(lastDate)}` : 'recent events';

  elements.summary.textContent = `Tracking ${archetypes} archetypes across ${tournaments} tournaments (${windowLabel}). Last updated ${lastUpdated}.`;
}

function updateMinSliderBounds() {
  const minSlider = elements.minSlider;
  const minValue = elements.minValue;

  if (!minSlider || !minValue) {
    return;
  }
  const tournamentCount = state.trendData?.tournaments?.length || Number(minSlider.max) || 8;
  const requiredMin = Math.max(1, Math.floor(tournamentCount / 2));
  const max = Math.max(requiredMin, tournamentCount);
  state.minAppearances = requiredMin;
  minSlider.max = String(max);
  minSlider.value = String(requiredMin);
  minSlider.disabled = true;
  minValue.textContent = `${requiredMin}+ (auto)`;
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

  const peak = document.createElement('div');
  peak.className = 'trend-card__stat';
  peak.textContent = `Peak share ${formatPercent(series.peakShare || series.maxShare)}`;

  const delta = document.createElement('div');
  delta.className = 'trend-card__stat';
  const firstShare = series.timeline[0]?.share || 0;
  const latestShare = series.timeline[series.timeline.length - 1]?.share || 0;
  const change = Math.round((latestShare - firstShare) * 10) / 10;
  const sign = change > 0 ? '+' : '';
  delta.textContent = `Change ${sign}${change.toFixed(Math.abs(change) % 1 === 0 ? 0 : 1)}%`;

  stats.appendChild(appearances);
  stats.appendChild(avg);
  stats.appendChild(peak);
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
  const metaChart = buildMetaLines(state.trendData, 8);
  const metaMovers = buildMetaLines(state.trendData, 16) || metaChart;
  if (!metaChart || !metaChart.lines?.length) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = 'Not enough data to show meta trends yet.';
    elements.metaChart.appendChild(empty);
    return;
  }

  const width = 900;
  const height = 340;
  const padX = 36;
  const padY = 28;
  const contentWidth = width - padX * 2;
  const contentHeight = height - padY * 2;
  const count = metaChart.dates.length;

  // Dynamic Y domain based on visible data (add headroom)
  const maxObserved = Math.max(...metaChart.lines.flatMap(line => line.points.map(p => Math.max(0, Number(p) || 0))));
  const buffer = Math.max(1, maxObserved * 0.05);
  const yMax = Math.min(100, Math.max(5, Math.ceil((maxObserved + buffer) / 5) * 5));

  const xForIndex = idx => (count === 1 ? contentWidth / 2 : (idx / (count - 1)) * contentWidth) + padX;
  const yForShare = share => height - padY - (Math.min(share, yMax) / yMax) * contentHeight;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '260');
  svg.setAttribute('role', 'img');
  svg.classList.add('meta-svg');

  // grid lines based on yMax
  const gridLevels = [];
  for (let lvl = 0; lvl <= yMax; lvl += Math.max(5, Math.ceil(yMax / 5))) {
    gridLevels.push(lvl);
  }
  gridLevels.forEach(level => {
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

  metaChart.lines.forEach(line => {
    const points = line.points.map((share, idx) => `${xForIndex(idx)},${yForShare(share)}`).join(' ');
    const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    polyline.setAttribute('fill', 'none');
    polyline.setAttribute('stroke', line.color);
    polyline.setAttribute('stroke-width', '2.5');
    polyline.setAttribute('points', points);
    polyline.setAttribute('stroke-linecap', 'round');
    polyline.dataset.name = line.name;
    polyline.classList.add('meta-line');

    // Add a wider invisible hover stroke to make it easier to hit
    const hitline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    hitline.setAttribute('fill', 'none');
    hitline.setAttribute('stroke', line.color);
    hitline.setAttribute('stroke-width', '12');
    hitline.setAttribute('stroke-opacity', '0');
    hitline.setAttribute('points', points);
    hitline.dataset.name = line.name;
    hitline.classList.add('meta-line-hit');

    svg.appendChild(polyline);
    svg.appendChild(hitline);
  });

  // x-axis labels (dates)
  metaChart.dates.forEach((d, idx) => {
    const x = xForIndex(idx);
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', `${x}`);
    label.setAttribute('y', `${height - 6}`);
    label.setAttribute('fill', '#7c86a8');
    label.setAttribute('font-size', '11');
    label.setAttribute('text-anchor', 'middle');
    label.textContent = formatDate(d);
    svg.appendChild(label);
  });

  elements.metaChart.appendChild(svg);
  if (elements.metaRange) {
    elements.metaRange.textContent = `Y-axis scaled to ${yMax}%`;
  }
  renderLegend(metaChart.lines);
  renderMovers(metaMovers?.lines || metaChart.lines);

  // Hover highlight wiring
  if (!elements.metaChart) {
    return;
  }

  const lines = Array.from(elements.metaChart.querySelectorAll<HTMLElement>('.meta-line'));
  const hitlines = Array.from(elements.metaChart.querySelectorAll<HTMLElement>('.meta-line-hit'));
  const legendItems = elements.legend
    ? Array.from(elements.legend.querySelectorAll<HTMLElement>('.legend-item'))
    : [];

  const setActive = name => {
    lines.forEach(line => {
      const active = line.dataset.name === name;
      line.style.opacity = active ? '1' : '0.25';
      line.style.strokeWidth = active ? '3.5' : '2';
    });
    legendItems.forEach(item => {
      const label = item.querySelector('span:nth-child(2)');
      const active = label && label.textContent === name;
      item.style.opacity = active ? '1' : '0.5';
      const swatch = item.querySelector<HTMLElement>('.legend-swatch');
      item.style.borderColor = active ? swatch?.style.backgroundColor || '#6aa3ff' : '#2c335a';
    });
  };

  const clearActive = () => {
    lines.forEach(line => {
      line.style.opacity = '1';
      line.style.strokeWidth = '2.5';
    });
    legendItems.forEach(item => {
      item.style.opacity = '1';
      item.style.borderColor = '#2c335a';
    });
  };

  [...lines, ...hitlines].forEach(line => {
    line.addEventListener('mouseenter', () => setActive(line.dataset.name));
    line.addEventListener('mouseleave', clearActive);
  });

  legendItems.forEach(item => {
    const label = item.querySelector('span:nth-child(2)');
    const name = label?.textContent;
    if (!name) {
      return;
    }
    item.addEventListener('mouseenter', () => setActive(name));
    item.addEventListener('mouseleave', clearActive);
  });
}

function renderList() {
  if (!elements.list) {
    return;
  }
  elements.list.innerHTML = '';

  if (!state.trendData) {
    return;
  }

  const filtered = (state.trendData.series || []).filter(item => item.appearances >= state.minAppearances);

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
    const decks = await fetchAllDecks(TRENDS_SOURCE);
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
    state.trendData = { ...recomputed };
    state.cardTrends = cardTrends;
    updateMinSliderBounds();
    setStatus('Recomputed from latest decks');
    renderSummary();
    renderMetaChart();
    renderCardMovers(state.suggestions || { onTheRise: [], choppedAndWashed: [] }, state.cardTrends);
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
    elements.minSlider.disabled = true;
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
    const payload = await fetchTrendReport(TRENDS_SOURCE);
    state.trendData = payload?.trendReport || payload || null;
    state.cardTrends = payload?.cardTrends || null;
    state.suggestions = payload?.suggestions || null;
    updateMinSliderBounds();
    renderSummary();
    renderMetaChart();
    renderCardMovers(state.suggestions || { onTheRise: [], choppedAndWashed: [] }, state.cardTrends);
    renderList();
    setStatus(`Showing pre-generated trends for ${TRENDS_SOURCE}`);
  } catch (error) {
    logger.warn('Failed to load pre-generated trends, falling back to decks', {
      message: error?.message || error
    });
    setStatus('Falling back to deck data...');
    try {
      const decks = await fetchAllDecks(TRENDS_SOURCE);
      const fallbackTournaments = deriveTournamentsFromDecks(decks);
      const archetypeTrends = buildTrendDataset(decks, fallbackTournaments, { minAppearances: 1 });
      const cardTrends = buildCardTrendDataset(decks, fallbackTournaments, { minAppearances: 2 });
      state.trendData = archetypeTrends;
      state.cardTrends = cardTrends;
      state.suggestions = null;
      updateMinSliderBounds();
      renderSummary();
      renderMetaChart();
      renderCardMovers({ onTheRise: [], choppedAndWashed: [] }, state.cardTrends);
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
