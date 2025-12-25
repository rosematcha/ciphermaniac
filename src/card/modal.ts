/**
 * Card image modal controller
 * Handles the full-size card image modal display with keyboard navigation and focus management
 * @module card/modal
 */

import { normalizeCardNumber } from './routing.js';
import { normalizeSetCode } from '../utils/filterState.js';

// Types
export type VariantInfo = { set?: string; number?: string | number };

export interface CardImageModalOpenOptions {
  src: string | null;
  fallback?: string | null;
  alt?: string | null;
  caption?: string | null;
  trigger?: HTMLElement | null;
}

export interface CardImageModalController {
  open(options: CardImageModalOpenOptions): void;
  close(): void;
}

// Constants
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const LIMITLESS_SIZE_PATTERN =
  /(https:\/\/limitlesstcg\.nyc3\.cdn\.digitaloceanspaces\.com\/tpci\/[^/]+\/[^_]+_\d{3}[A-Z0-9]*_R_[A-Z]{2})_(XS|SM)\.png$/i;

// Module state
let cardImageModalController: CardImageModalController | null = null;

/**
 * Derive a large-format URL from a thumbnail candidate URL
 * @param url - The thumbnail URL to transform
 * @returns The large-format URL or null if not derivable
 */
export function deriveLgUrlFromCandidate(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }
  const trimmed = String(url).trim();
  if (!trimmed) {
    return null;
  }
  const match = trimmed.match(LIMITLESS_SIZE_PATTERN);
  if (match) {
    return `${match[1]}_LG.png`;
  }
  return null;
}

/**
 * Build a large-format URL directly from variant information
 * @param variant - The card variant info with set and number
 * @returns The large-format URL or null if not buildable
 */
export function buildLgUrlFromVariant(variant: VariantInfo | undefined): string | null {
  if (!variant || !variant.set || !variant.number) {
    return null;
  }
  const setCode = normalizeSetCode(variant.set);
  const normalizedNumber = normalizeCardNumber(variant.number);
  if (!setCode || !normalizedNumber) {
    return null;
  }
  const padded = normalizedNumber.padStart(3, '0');
  return `https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/${setCode}/${setCode}_${padded}_R_EN_LG.png`;
}

/**
 * Get or create the card image modal controller singleton
 * Creates the modal DOM on first call (lazy initialization)
 * @returns The modal controller or null if creation failed
 */
export function ensureCardImageModal(): CardImageModalController | null {
  if (cardImageModalController) {
    return cardImageModalController;
  }

  // Lazy-create modal HTML on first use to optimize initial page load
  let container = document.getElementById('card-image-modal');
  if (!container) {
    container = document.createElement('div');
    container.id = 'card-image-modal';
    container.className = 'card-image-modal';
    container.setAttribute('aria-hidden', 'true');
    container.setAttribute('role', 'dialog');
    container.setAttribute('aria-modal', 'true');
    container.setAttribute('aria-labelledby', 'card-image-modal-caption');
    container.innerHTML = `
            <div class="card-image-modal__backdrop" data-card-modal-close="true"></div>
            <div class="card-image-modal__dialog" role="document">
                <button type="button" class="card-image-modal__close" aria-label="Close full-size image" data-card-modal-close="true">&times;</button>
                <div class="card-image-modal__image-wrap">
                    <img id="card-image-modal-img" data-card-modal-image alt="" decoding="async" />
                </div>
                <p id="card-image-modal-caption" class="card-image-modal__caption" data-card-modal-caption>Full-size card image</p>
            </div>
        `;
    document.body.appendChild(container);
  }

  const dialog = container.querySelector('.card-image-modal__dialog') as HTMLElement | null;
  const image = container.querySelector('[data-card-modal-image]') as HTMLImageElement | null;
  const caption = container.querySelector('[data-card-modal-caption]') as HTMLElement | null;
  const closeElements = Array.from(container.querySelectorAll('[data-card-modal-close]')) as HTMLElement[];

  if (!dialog || !image) {
    return null;
  }

  let previouslyFocused: HTMLElement | null = null;
  let pendingFallback: string | null = null;
  let focusableElements: HTMLElement[] = [];

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      api.close();
      return;
    }

    if (event.key === 'Tab' && focusableElements.length > 0) {
      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  const handleImageLoad = () => {
    container.classList.remove('is-loading');
    container.classList.remove('has-error');
  };

  const handleImageError = () => {
    if (pendingFallback) {
      const fallbackUrl = pendingFallback;
      pendingFallback = null;
      image.src = fallbackUrl;
      return;
    }
    container.classList.add('has-error');
    container.classList.remove('is-loading');
  };

  image.addEventListener('load', handleImageLoad);
  image.addEventListener('error', handleImageError);

  const api: CardImageModalController = {
    open(options: CardImageModalOpenOptions) {
      if (!options || !options.src) {
        return;
      }

      pendingFallback = options.fallback && options.fallback !== options.src ? options.fallback : null;
      previouslyFocused = options.trigger || (document.activeElement as HTMLElement | null);
      container.classList.add('is-visible', 'is-loading');
      container.setAttribute('aria-hidden', 'false');
      document.body.classList.add('card-image-modal-open');
      image.alt = options.alt || 'Full-size card image';
      if (caption) {
        caption.textContent = options.caption || image.alt;
      }
      image.src = options.src;
      focusableElements = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(el => {
        return !el.hasAttribute('disabled') && el.getAttribute('tabindex') !== '-1';
      });
      const focusTarget = focusableElements[0] || dialog;
      requestAnimationFrame(() => {
        focusTarget?.focus();
      });
      document.addEventListener('keydown', handleKeyDown);
    },
    close() {
      container.classList.remove('is-visible', 'is-loading', 'has-error');
      container.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('card-image-modal-open');
      pendingFallback = null;
      focusableElements = [];
      image.removeAttribute('src');
      document.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocused) {
        previouslyFocused.focus();
        previouslyFocused = null;
      }
    }
  };

  closeElements.forEach(el => {
    el.addEventListener('click', () => api.close());
  });

  container.addEventListener('click', event => {
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }
    if (target.dataset.cardModalClose === 'true' || target === container) {
      api.close();
    }
  });

  return (cardImageModalController = api);
}

/**
 * Enable click-to-expand functionality on a card hero image
 * @param trigger - The element that triggers the modal (usually the image wrapper)
 * @param image - The image element to display in the modal
 * @param variantLgUrl - Pre-computed large-format URL for the variant
 * @param cardName - The card name for accessibility labels
 */
export function enableHeroImageModal(
  trigger: HTMLElement,
  image: HTMLImageElement,
  variantLgUrl: string | null,
  cardName: string | null
): void {
  if (!trigger || !image) {
    return;
  }

  trigger.classList.add('card-hero__trigger');
  // eslint-disable-next-line no-param-reassign
  trigger.tabIndex = 0;
  trigger.setAttribute('role', 'button');
  trigger.setAttribute('aria-label', 'Open high-resolution card image');

  const handleActivate = () => {
    const controller = ensureCardImageModal();
    if (!controller) {
      return;
    }

    const fallback = image.currentSrc || image.src;
    const altText = image.alt || cardName || 'Card image';
    const hiRes = (image as any)._fullResUrl || variantLgUrl || fallback;
    controller.open({
      src: hiRes,
      fallback,
      alt: altText,
      caption: cardName ? `${cardName} — Full-size view` : altText,
      trigger
    });
  };

  trigger.addEventListener('click', handleActivate);
  trigger.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleActivate();
    }
  });
}
