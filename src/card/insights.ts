/**
 * Card Insights — rich metadata, trend indicators, external links
 * @module card/insights
 */

import { getCardData } from '../api.js';
import { getCanonicalCard, getCardVariants } from '../utils/cardSynonyms.js';
import { parseDisplayName } from './identifiers.js';
import { logger } from '../utils/errorHandler.js';

// ─── Types ───────────────────────────────────────────────────────────────────

interface CardMeta {
  category?: string;
  trainerType?: string;
  energyType?: string;
  aceSpec?: boolean;
  regulationMark?: string;
  supertype?: string;
  rank?: number;
}

interface TournamentDataPoint {
  tournament: string;
  pct: number;
  found?: number | null;
  total?: number | null;
  dist?: { copies: number; players: number }[] | null;
}

// ─── Category helpers ────────────────────────────────────────────────────────

function getCategoryLabel(meta: CardMeta): string {
  if (meta.category?.startsWith('pokemon')) {
    return 'Pokémon';
  }
  if (meta.category?.startsWith('trainer')) {
    return 'Trainer';
  }
  if (meta.category?.startsWith('energy')) {
    return 'Energy';
  }
  if (meta.supertype) {
    return meta.supertype;
  }
  return '';
}

function getSubtypeLabel(meta: CardMeta): string {
  if (meta.trainerType) {
    return meta.trainerType.charAt(0).toUpperCase() + meta.trainerType.slice(1);
  }
  if (meta.energyType) {
    return meta.energyType.charAt(0).toUpperCase() + meta.energyType.slice(1);
  }
  return '';
}

function getCategoryClass(meta: CardMeta): string {
  if (meta.category?.startsWith('pokemon')) {
    return 'pokemon';
  }
  if (meta.category?.startsWith('trainer')) {
    return 'trainer';
  }
  if (meta.category?.startsWith('energy')) {
    return 'energy';
  }
  return 'unknown';
}

// ─── SVG icons ───────────────────────────────────────────────────────────────

const ICONS = {
  trendUp: `<svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M2 10l4-4 2 2 4-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M8.5 3H12v3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  trendDown: `<svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M2 4l4 4 2-2 4 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M8.5 11H12v-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  external: `<svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M9 6.5v3a1 1 0 01-1 1H2.5a1 1 0 01-1-1V4a1 1 0 011-1h3M7.5 1.5h3v3M5.5 6.5l5-5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  star: `<svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M7 1l1.76 3.57 3.94.57-2.85 2.78.67 3.93L7 10.07l-3.52 1.78.67-3.93L1.3 5.14l3.94-.57L7 1z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>`,
  ace: `<svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M7 1L8.8 5.2 13 5.8 9.9 8.5 10.7 13 7 10.8 3.3 13 4.1 8.5 1 5.8 5.2 5.2z" fill="currentColor"/></svg>`
};

// ─── Render: Card Identity Bar ───────────────────────────────────────────────

export function renderCardIdentityBar(container: HTMLElement, meta: CardMeta): void {
  const bar = document.createElement('div');
  bar.className = 'card-identity-bar';
  bar.setAttribute('aria-label', 'Card attributes');

  const pills: string[] = [];

  // Category pill
  const catLabel = getCategoryLabel(meta);
  if (catLabel) {
    const catClass = getCategoryClass(meta);
    pills.push(`<span class="card-pill card-pill--${catClass}">${catLabel}</span>`);
  }

  // Subtype pill
  const subLabel = getSubtypeLabel(meta);
  if (subLabel) {
    pills.push(`<span class="card-pill card-pill--subtype">${subLabel}</span>`);
  }

  // Ace Spec badge
  if (meta.aceSpec) {
    pills.push(`<span class="card-pill card-pill--ace" title="Ace Spec card">${ICONS.ace}<span>Ace Spec</span></span>`);
  }

  // Regulation mark
  if (meta.regulationMark) {
    pills.push(
      `<span class="card-pill card-pill--reg" title="Regulation Mark ${meta.regulationMark}">${meta.regulationMark}</span>`
    );
  }

  // Rank badge
  if (meta.rank && meta.rank > 0) {
    pills.push(
      `<span class="card-pill card-pill--rank" title="Rank #${meta.rank} in current format">${ICONS.star}<span>#${meta.rank}</span></span>`
    );
  }

  if (pills.length === 0) {
    return;
  }

  bar.innerHTML = pills.join('');
  container.appendChild(bar);

  // Stagger fade-in
  requestAnimationFrame(() => {
    const children = bar.querySelectorAll('.card-pill');
    children.forEach((el, i) => {
      (el as HTMLElement).style.animationDelay = `${i * 60}ms`;
      el.classList.add('card-pill--visible');
    });
  });
}

// ─── Render: Stat Line (replaces insight cards) ─────────────────────────────

export function renderStatLine(container: HTMLElement, dataPoints: TournamentDataPoint[]): void {
  if (dataPoints.length === 0) {
    return;
  }

  const latest = dataPoints[dataPoints.length - 1];
  const previous = dataPoints.length > 1 ? dataPoints[dataPoints.length - 2] : null;

  const parts: string[] = [];

  // Format share — the hero number
  if (latest) {
    parts.push(
      `<span class="stat-line__hero">${latest.pct.toFixed(1)}%</span><span class="stat-line__label">of decks</span>`
    );
  }

  // Trend
  if (latest && previous) {
    const delta = latest.pct - previous.pct;
    const absDelta = Math.abs(delta);
    const direction = delta > 0.5 ? 'up' : delta < -0.5 ? 'down' : 'flat';
    if (direction !== 'flat') {
      const icon = direction === 'up' ? ICONS.trendUp : ICONS.trendDown;
      const cls = direction === 'up' ? 'stat-line__trend--up' : 'stat-line__trend--down';
      parts.push(
        `<span class="stat-line__sep">·</span><span class="stat-line__trend ${cls}">${icon} ${delta > 0 ? '+' : ''}${absDelta.toFixed(1)}%</span>`
      );
    } else {
      parts.push(
        `<span class="stat-line__sep">·</span><span class="stat-line__trend stat-line__trend--flat">stable</span>`
      );
    }
  }

  // Deck count
  if (latest?.found && latest?.total) {
    parts.push(
      `<span class="stat-line__sep">·</span><span class="stat-line__detail">${latest.found.toLocaleString()} / ${latest.total.toLocaleString()} decks</span>`
    );
  }

  // Preferred copy count
  if (latest?.dist && latest.dist.length > 0) {
    const totalPlayers = latest.dist.reduce((sum, d) => sum + d.players, 0);
    const preferred = [...latest.dist].sort((a, b) => b.players - a.players)[0];
    if (preferred && totalPlayers > 0) {
      const pctOfUsers = ((preferred.players / totalPlayers) * 100).toFixed(0);
      parts.push(
        `<span class="stat-line__sep">·</span><span class="stat-line__detail">${preferred.copies}× copy <span class="stat-line__muted">(${pctOfUsers}%)</span></span>`
      );
    }
  }

  if (parts.length === 0) {
    return;
  }

  const line = document.createElement('div');
  line.className = 'stat-line';
  line.innerHTML = parts.join('');
  container.appendChild(line);

  requestAnimationFrame(() => {
    line.classList.add('stat-line--visible');
  });
}

// ─── Render: External Links (inline) ─────────────────────────────────────────

export async function renderExternalLinks(
  container: HTMLElement,
  cardIdentifier: string,
  cardName: string
): Promise<void> {
  const parsed = parseDisplayName(cardName);
  const setId = parsed?.setId || '';
  let setCode = '';
  let cardNumber = '';

  if (setId) {
    const parts = setId.split(' ');
    if (parts.length >= 2) {
      setCode = parts[0];
      cardNumber = parts[1];
    }
  }

  const links: { label: string; url: string }[] = [];

  // TCGPlayer link
  try {
    let tcgPlayerId: string | null = null;
    const cardData = await getCardData(cardIdentifier);
    if (cardData?.tcgPlayerId) {
      ({ tcgPlayerId } = cardData);
    } else {
      const canonical = await getCanonicalCard(cardIdentifier);
      const variants = await getCardVariants(canonical || cardIdentifier);
      for (const variant of variants) {
        const vData = await getCardData(variant);
        if (vData?.tcgPlayerId) {
          ({ tcgPlayerId } = vData);
          break;
        }
      }
    }
    if (tcgPlayerId) {
      links.push({ label: 'TCGPlayer', url: `https://www.tcgplayer.com/product/${tcgPlayerId}` });
    }
  } catch {
    logger.debug('Failed to get TCGPlayer link');
  }

  // Limitless TCG link
  if (setCode && cardNumber) {
    links.push({ label: 'Limitless', url: `https://limitlesstcg.com/cards/${setCode}/${cardNumber}` });
  }

  if (links.length === 0) {
    return;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'card-ref-links';

  for (const link of links) {
    const a = document.createElement('a');
    a.className = 'card-ref-link';
    a.href = link.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.innerHTML = `${link.label} ${ICONS.external}`;
    wrapper.appendChild(a);
  }

  container.appendChild(wrapper);

  requestAnimationFrame(() => {
    wrapper.classList.add('card-ref-links--visible');
  });
}

// ─── Extract metadata from a CardItem ────────────────────────────────────────

export function extractCardMeta(cardItem: any): CardMeta {
  return {
    category: cardItem?.category || undefined,
    trainerType: cardItem?.trainerType || undefined,
    energyType: cardItem?.energyType || undefined,
    aceSpec: cardItem?.aceSpec || false,
    regulationMark: cardItem?.regulationMark || undefined,
    supertype: cardItem?.supertype || undefined,
    rank: cardItem?.rank || undefined
  };
}
