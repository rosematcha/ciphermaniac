import { elements } from '../state';
import {
  aggregateCardMoverDirection,
  buildArchetypeHref,
  buildCardHref,
  createMoverMedia,
  formatPercent,
  formatSignedPercent,
  getArchetypeThumbUrl,
  getCardThumbUrl
} from '../aggregator';
import type { CardTrendsState, DisplayCardMover, MetaLine } from '../types';

export function renderLegend(lines: MetaLine[]): void {
  const { legend } = elements;
  if (!legend) {
    return;
  }
  legend.innerHTML = '';
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
    label.className = 'legend-name';
    label.textContent = line.name;
    const value = document.createElement('span');
    value.className = 'legend-value';
    const sign = line.delta > 0 ? '+' : '';
    const deltaClass = line.delta > 0 ? 'up' : line.delta < 0 ? 'down' : '';
    value.innerHTML = `${formatPercent(line.windowShare)} <span class="legend-delta ${deltaClass}">(${sign}${line.delta.toFixed(Math.abs(line.delta) % 1 === 0 ? 0 : 1)}%)</span>`;
    item.appendChild(swatch);
    item.appendChild(label);
    item.appendChild(value);
    legend.appendChild(item);
  });
}

export function renderMovers(lines: MetaLine[]): void {
  if (!elements.movers) {
    return;
  }
  elements.movers.innerHTML = '';
  if (!lines || !lines.length) {
    return;
  }

  const sorted = [...lines].filter(line => line.name !== 'Other');
  sorted.sort((a, b) => b.delta - a.delta);
  const rising = sorted.slice(0, 3);
  const falling = [...sorted].sort((a, b) => a.delta - b.delta).slice(0, 3);

  const buildGroup = (title: string, items: MetaLine[], direction: 'up' | 'down') => {
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
    items.forEach((item, index) => {
      const li = document.createElement('li');
      const link = document.createElement('a');
      link.className = 'mover-link';
      link.href = buildArchetypeHref(item.name);

      const mediaUrl = getArchetypeThumbUrl(item.name);
      const media = createMoverMedia(item.name, mediaUrl);
      link.appendChild(media);

      const copy = document.createElement('span');
      copy.className = 'mover-copy';

      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = item.name;

      const share = document.createElement('span');
      share.className = 'perc';
      share.textContent = `#${index + 1} | ${formatPercent(item.windowShare)} share`;

      copy.appendChild(name);
      copy.appendChild(share);
      link.appendChild(copy);

      const delta = document.createElement('span');
      delta.className = `delta ${direction}`;
      delta.textContent = formatSignedPercent(item.delta);
      link.appendChild(delta);

      li.appendChild(link);
      list.appendChild(li);
    });
    group.appendChild(list);
    return group;
  };

  elements.movers.appendChild(buildGroup('Rising', rising, 'up'));
  elements.movers.appendChild(buildGroup('Cooling', falling, 'down'));
}

export function renderCardMovers(cardTrends: CardTrendsState): void {
  if (!elements.cardMovers) {
    return;
  }
  elements.cardMovers.innerHTML = '';
  const risingList = (cardTrends && 'rising' in cardTrends ? cardTrends.rising : []) || [];
  const fallingList = (cardTrends && 'falling' in cardTrends ? cardTrends.falling : []) || [];

  if (!risingList.length && !fallingList.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'Card movement will appear once enough tournaments are available.';
    elements.cardMovers.appendChild(empty);
    return;
  }

  const merged = {
    rising: aggregateCardMoverDirection(risingList, 'up'),
    falling: aggregateCardMoverDirection(fallingList, 'down')
  };

  const buildGroup = (title: string, list: DisplayCardMover[], direction: 'up' | 'down') => {
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
      const link = document.createElement('a');
      link.className = 'mover-link mover-link--card';
      link.href = buildCardHref(item);

      link.appendChild(createMoverMedia(item.name, getCardThumbUrl(item)));

      const copy = document.createElement('span');
      copy.className = 'mover-copy';

      const name = document.createElement('span');
      name.className = 'name';
      const idLabel = item.set && item.number ? ` (${item.set} ${item.number})` : '';
      name.textContent = `${item.name}${idLabel}`;

      const share = document.createElement('span');
      share.className = 'perc';
      const printingsLabel = item.variantCount > 1 ? ` | ${item.variantCount} printings` : '';
      if (direction === 'down') {
        share.textContent = `Was ${formatPercent(item.start || 0)} → ${formatPercent(item.latest || 0)}${printingsLabel}`;
      } else {
        share.textContent = `Seen in ${formatPercent(item.latest || 0)} of decks${printingsLabel}`;
      }

      copy.appendChild(name);
      copy.appendChild(share);
      link.appendChild(copy);

      const delta = document.createElement('span');
      delta.className = `delta ${direction}`;
      delta.textContent = formatSignedPercent(item.delta || 0);
      link.appendChild(delta);

      li.appendChild(link);
      ul.appendChild(li);
    });
    group.appendChild(ul);
    return group;
  };

  elements.cardMovers.appendChild(buildGroup('Cards rising', merged.rising, 'up'));
  elements.cardMovers.appendChild(buildGroup('Cards cooling', merged.falling, 'down'));
}
