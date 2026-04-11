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

// ─── SVG icons ───────────────────────────────────────────────────────────────

const ICONS = {
  external: `<svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M9 6.5v3a1 1 0 01-1 1H2.5a1 1 0 01-1-1V4a1 1 0 011-1h3M7.5 1.5h3v3M5.5 6.5l5-5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`
};

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
