/**
 * Card data utilities and processing functions
 * @module card/data
 */

import { fetchReport, fetchTournamentsList, getCardPrice } from '../api.js';
import { parseReport } from '../parse.js';
import { getBaseName, getCanonicalId, getDisplayName, parseDisplayName } from './identifiers.js';
import { ErrorBoundary, logger, validators } from '../utils/errorHandler.js';
import { getCanonicalCard, getCardVariants } from '../utils/cardSynonyms.js';

interface CardItem {
  set?: string;
  number?: string | number;
  name?: string;
  uid?: string;
  count?: number;
  [key: string]: any;
}

interface ParsedReport {
  items: CardItem[];
  [key: string]: any;
}

interface VariantsCacheEntry {
  variants: string[];
  timestamp: number;
}

interface VariantsCache {
  [key: string]: VariantsCacheEntry;
}

/**
 * Find a card in items array by identifier
 * @param items - Array of card items
 * @param cardIdentifier - Card identifier to search for
 * @returns Found card item or null
 */
export function findCard(items: CardItem[], cardIdentifier: string): CardItem | null {
  try {
    // Enhanced input validation
    const validatedIdentifier = validators.cardIdentifier(cardIdentifier);
    validators.array(items);

    logger.debug('findCard called', {
      cardIdentifier: validatedIdentifier,
      itemsCount: items.length
    });
  } catch (error: any) {
    logger.debug('findCard validation failed', {
      cardIdentifier,
      error: error.message
    });
    return null;
  }

  const lower = cardIdentifier.toLowerCase();

  // First try direct UID match
  const directUidMatch = items.find(item => item.uid && item.uid.toLowerCase() === lower);
  if (directUidMatch) {
    return directUidMatch;
  }

  // Try exact name match (for trainers without UIDs)
  const exactNameMatch = items.find(item => item.name && item.name.toLowerCase() === lower);
  if (exactNameMatch) {
    return exactNameMatch;
  }

  // Try UID-to-display-name conversion ("Name SET NUMBER" format)
  for (const item of items) {
    if (item.uid) {
      const displayName = getDisplayName(item.uid);
      if (displayName && displayName.toLowerCase() === lower) {
        return item;
      }
    }
  }

  // Check if this looks like a specific variant request that failed
  if (cardIdentifier.includes(' ') && /[A-Z]{2,4}\s\d+/i.test(cardIdentifier)) {
    // This looks like "Name SET NUMBER" but we didn't find an exact match
    return null;
  }

  // Pure base name query - only return exact name matches (trainers)
  const baseNameMatches = items.filter(item => {
    const baseName = getBaseName(getCanonicalId(item as { uid?: string; name: string }));
    return baseName && baseName.toLowerCase() === lower;
  });

  if (baseNameMatches.length === 0) {
    return null;
  }

  // Only return base name matches for cards without UIDs (trainers)
  const withoutUid = baseNameMatches.find(item => !item.uid);
  if (withoutUid) {
    return withoutUid;
  }

  // For Pokemon with only UID variants, return null for base name queries
  return null;
}

/**
 * Collect all variants of a card across tournaments
 * @param cardIdentifier - Base card identifier
 * @returns Array of card variants
 */
export async function collectCardVariants(cardIdentifier: string): Promise<string[]> {
  let validatedIdentifier: string;
  let searchBaseName: string | null;

  try {
    validatedIdentifier = validators.cardIdentifier(cardIdentifier);
    searchBaseName = getBaseName(validatedIdentifier);

    if (!searchBaseName) {
      logger.debug('collectCardVariants: no base name found', {
        cardIdentifier: validatedIdentifier
      });
      return [];
    }

    logger.debug('collectCardVariants started', {
      cardIdentifier: validatedIdentifier,
      baseName: searchBaseName
    });
  } catch (error: any) {
    logger.warn('collectCardVariants validation failed', {
      cardIdentifier,
      error: error.message
    });
    return [];
  }

  // Use aggressive caching for variants to avoid repeated network calls
  const VARIANTS_CACHE_KEY = 'cardVariantsV2';
  const CACHE_EXPIRY = 1000 * 60 * 60 * 24; // 24 hours

  let variantsCache: VariantsCache;
  try {
    variantsCache = JSON.parse(localStorage.getItem(VARIANTS_CACHE_KEY) || '{}');
  } catch {
    variantsCache = {};
  }

  const cacheKey = searchBaseName.toLowerCase();
  const cachedEntry = variantsCache[cacheKey];

  // Return cached data if fresh
  if (cachedEntry && Date.now() - cachedEntry.timestamp < CACHE_EXPIRY) {
    return cachedEntry.variants.sort();
  }

  const variants = new Set<string>();
  let tournaments: string[] = [];

  try {
    const list = await fetchTournamentsList();
    tournaments = Array.isArray(list) ? (list as string[]) : [];
  } catch {
    tournaments = ['2025-08-15, World Championships 2025'];
  }

  if (!Array.isArray(tournaments) || tournaments.length === 0) {
    tournaments = ['2025-08-15, World Championships 2025'];
  }

  // Optimize for performance: limit to recent tournaments for variants collection
  // Most card variants appear across multiple recent tournaments
  const RECENT_LIMIT = 8; // Check the 8 most recent tournaments for variants
  const recentTournaments = tournaments.slice(0, RECENT_LIMIT);

  // Parallelize tournament data collection with higher concurrency since we're processing fewer tournaments
  const promises = recentTournaments.map(async tournament => {
    try {
      const master = await fetchReport(tournament);
      const parsed = parseReport(master) as ParsedReport;
      const tournamentVariants = new Set<string>();

      for (const item of parsed.items) {
        const canonicalId = getCanonicalId(item as { uid?: string; name: string });
        const itemBaseName = getBaseName(canonicalId);

        if (itemBaseName && itemBaseName.toLowerCase() === searchBaseName!.toLowerCase()) {
          // Add canonical display name
          const displayName = getDisplayName(canonicalId);
          if (displayName) {
            tournamentVariants.add(displayName);
          }
        }
      }

      return tournamentVariants;
    } catch {
      // Skip failed tournament loads
      return new Set<string>();
    }
  });

  const results = await Promise.all(promises);

  // Merge all variants
  for (const tournamentVariants of results) {
    for (const variant of tournamentVariants) {
      variants.add(variant);
    }
  }

  const variantsList = Array.from(variants);

  // Cache the results for future use
  try {
    variantsCache[cacheKey] = {
      variants: variantsList,
      timestamp: Date.now()
    };
    localStorage.setItem(VARIANTS_CACHE_KEY, JSON.stringify(variantsCache));
  } catch {
    // Ignore cache storage errors
  }

  return variantsList.sort();
}

/**
 * Render card price information
 * @param cardIdentifier - Card identifier
 */
export async function renderCardPrice(cardIdentifier: string): Promise<void> {
  const priceContainer = document.getElementById('card-price');
  if (!priceContainer) {
    logger.debug('renderCardPrice: price container not found');
    return;
  }

  try {
    const validatedIdentifier = validators.cardIdentifier(cardIdentifier);
    logger.debug('renderCardPrice started', {
      cardIdentifier: validatedIdentifier
    });

    const errorBoundary = new ErrorBoundary(priceContainer, {
      showRetryButton: false,
      showErrorDetails: false
    });

    await errorBoundary.execute(() => loadAndDisplayPrice(validatedIdentifier, priceContainer), null, {
      loadingMessage: 'Loading price...',
      retryAttempts: 1
    });
  } catch (error) {
    logger.exception('renderCardPrice failed', error, { cardIdentifier });
    showPriceError(priceContainer, 'Unable to load price data');
  }
}

/**
 * Internal function to load and display price data
 * @param cardIdentifier - Validated card identifier
 * @param container - Price container element
 */
async function loadAndDisplayPrice(cardIdentifier: string, container: HTMLElement): Promise<void> {
  const priceElement = container;
  let price: number | null = null;

  // If cardIdentifier is already in UID format (Name::SET::NUMBER), use it directly
  if (cardIdentifier.includes('::')) {
    logger.debug('Direct UID lookup', { cardIdentifier });
    price = await getCardPrice(cardIdentifier);
  } else {
    // If cardIdentifier is just a name, try to find variants from the card sets
    logger.debug('Looking for variants', { cardIdentifier });

    try {
      const variants = await collectCardVariants(cardIdentifier);
      logger.debug('Found variants', {
        cardIdentifier,
        variantCount: variants.length
      });

      // Try to get price from the first available variant
      for (const variant of variants) {
        const { name, setId } = parseDisplayName(variant);
        let variantUID = variant;
        if (name && setId) {
          // setId is "SET NUMBER"
          const parts = setId.split(' ');
          if (parts.length >= 2) {
            variantUID = `${name}::${parts[0]}::${parts[1]}`;
          }
        }

        if (variantUID && variantUID.includes('::')) {
          logger.debug('Trying variant', { variantUID });
          price = await getCardPrice(variantUID);
          if (price !== null && price > 0) {
            logger.debug('Found price from variant', { variantUID, price });
            break;
          }
        }
      }
    } catch (variantError: any) {
      logger.warn('Failed to get card variants', {
        error: variantError.message
      });
      // Continue with null price instead of failing completely
    }
  }

  // Clear loading and show actual price
  priceElement.innerHTML = '';

  if (price !== null && price > 0) {
    showPrice(priceElement, price);
    logger.debug('Successfully displayed price', { cardIdentifier, price });
  } else {
    showPriceUnavailable(priceElement, 'Price data not available');
    logger.debug('No price found', { cardIdentifier });
  }
}

/**
 * Show price information in container with smooth fade-in
 * @param container - Container element
 * @param price - Price to display
 */
function showPrice(container: HTMLElement, price: number): void {
  const priceElement = document.createElement('div');
  priceElement.className = 'price-info';
  priceElement.style.opacity = '0';
  priceElement.style.transition = 'opacity 0.15s ease-out';
  priceElement.innerHTML = `
    <div class="price-label">Market Price:</div>
    <div class="price-value">$${price.toFixed(2)}</div>
  `;
  container.appendChild(priceElement);

  // Trigger fade-in on next frame
  requestAnimationFrame(() => {
    priceElement.style.opacity = '1';
  });
}

/**
 * Show price unavailable message with smooth fade-in
 * @param container - Container element
 * @param message - Message to display
 */
function showPriceUnavailable(container: HTMLElement, message: string): void {
  const noPriceElement = document.createElement('div');
  noPriceElement.className = 'price-info no-price';
  noPriceElement.style.opacity = '0';
  noPriceElement.style.transition = 'opacity 0.15s ease-out';
  noPriceElement.textContent = message;
  container.appendChild(noPriceElement);

  // Trigger fade-in on next frame
  requestAnimationFrame(() => {
    noPriceElement.style.opacity = '1';
  });
}

/**
 * Show price error message
 * @param container - Container element
 * @param message - Error message to display
 */
function showPriceError(container: HTMLElement, message: string): void {
  const errorElement = document.createElement('div');
  errorElement.className = 'price-info error';
  errorElement.textContent = message;
  container.appendChild(errorElement);
}

/**
 * Render card sets/variants information
 * Loads silently in the background - no loading message since this is non-critical data
 * @param cardIdentifier - Card identifier
 */
export async function renderCardSets(cardIdentifier: string): Promise<void> {
  const cardTitleEl = document.getElementById('card-title');
  if (!cardTitleEl) {
    logger.debug('renderCardSets: card-title element not found');
    return;
  }

  try {
    const validatedIdentifier = validators.cardIdentifier(cardIdentifier);
    logger.debug('renderCardSets started', {
      cardIdentifier: validatedIdentifier
    });

    // Ensure the card name span exists and is set correctly
    // This acts as a safety net in case updateCardTitle didn't run or its changes were lost
    const baseName = getBaseName(validatedIdentifier);
    let nameSpan = cardTitleEl.querySelector('.card-title-name') as HTMLElement | null;

    if (!nameSpan && baseName) {
      // Name span is missing - create it
      nameSpan = document.createElement('span');
      nameSpan.className = 'card-title-name';
      nameSpan.textContent = baseName;
      // Insert at the beginning of the title element
      cardTitleEl.insertBefore(nameSpan, cardTitleEl.firstChild);
      logger.debug('renderCardSets: created missing name span', { baseName });
    } else if (nameSpan && !nameSpan.textContent && baseName) {
      // Name span exists but is empty - fill it
      nameSpan.textContent = baseName;
      logger.debug('renderCardSets: filled empty name span', { baseName });
    }

    // Load actual synonyms/reprints from the synonym data
    // This shows true reprints (mechanically identical cards in different sets)
    // rather than just cards with the same name (which may be different cards)
    // First ensure the identifier is in canonical UID format for proper lookup
    const canonicalIdentifier = await getCanonicalCard(validatedIdentifier);
    const synonymVariants = await getCardVariants(canonicalIdentifier);

    // Convert UIDs to display names for extraction of set info
    const variants = synonymVariants
      .map(uid => getDisplayName(uid))
      .filter((displayName): displayName is string => displayName !== null);

    // Remove any existing card-title-set spans from the h1
    const existingSetSpans = cardTitleEl.querySelectorAll('.card-title-set');
    existingSetSpans.forEach(span => span.remove());

    if (variants.length === 0) {
      // No variants found
      logger.debug('No variants found', {
        cardIdentifier: validatedIdentifier
      });
    } else {
      // Extract just the UIDs (set codes and numbers) from variants
      const uids = variants
        .map(variant => {
          const { setId } = parseDisplayName(variant);
          return setId || null;
        })
        .filter(Boolean);

      if (uids.length > 0) {
        const MAX_VISIBLE = 5;
        const hasMore = uids.length > MAX_VISIBLE;
        const visibleUids = hasMore ? uids.slice(0, MAX_VISIBLE) : uids;
        const hiddenUids = hasMore ? uids.slice(MAX_VISIBLE) : [];

        // Create and append UIDs sub-heading with fade-in
        const setSpan = document.createElement('span');
        setSpan.className = 'card-title-set';
        setSpan.style.opacity = '0';
        setSpan.style.transition = 'opacity 0.15s ease-out';

        // Create visible sets text
        const visibleText = document.createElement('span');
        visibleText.className = 'set-visible';
        visibleText.textContent = visibleUids.join(', ');
        setSpan.appendChild(visibleText);

        if (hasMore) {
          // Create hidden sets container (initially hidden)
          const hiddenText = document.createElement('span');
          hiddenText.className = 'set-hidden';
          hiddenText.textContent = `, ${hiddenUids.join(', ')}`;
          hiddenText.style.display = 'none';
          setSpan.appendChild(hiddenText);

          // Create expand button
          const expandBtn = document.createElement('button');
          expandBtn.className = 'set-expand-btn';
          expandBtn.textContent = `+${hiddenUids.length}`;
          expandBtn.title = `Show ${hiddenUids.length} more set${hiddenUids.length > 1 ? 's' : ''}`;
          expandBtn.setAttribute('aria-expanded', 'false');
          expandBtn.setAttribute('aria-label', `Show ${hiddenUids.length} more sets`);

          expandBtn.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            const isExpanded = expandBtn.getAttribute('aria-expanded') === 'true';

            if (isExpanded) {
              // Collapse
              hiddenText.style.display = 'none';
              expandBtn.textContent = `+${hiddenUids.length}`;
              expandBtn.setAttribute('aria-expanded', 'false');
              expandBtn.title = `Show ${hiddenUids.length} more set${hiddenUids.length > 1 ? 's' : ''}`;
            } else {
              // Expand
              hiddenText.style.display = 'inline';
              expandBtn.textContent = '−'; // Minus sign to collapse
              expandBtn.setAttribute('aria-expanded', 'true');
              expandBtn.title = 'Show fewer';
            }
          });

          setSpan.appendChild(expandBtn);
        }

        cardTitleEl.appendChild(setSpan);

        logger.debug('Variants displayed', {
          cardIdentifier: validatedIdentifier,
          variantCount: variants.length,
          visibleCount: visibleUids.length,
          hiddenCount: hiddenUids.length
        });

        // Trigger fade-in
        requestAnimationFrame(() => {
          setSpan.style.opacity = '1';
        });
      }
    }
  } catch (error) {
    // Silently fail for this non-critical section - just log the error
    logger.debug('renderCardSets failed silently', {
      cardIdentifier,
      error: error instanceof Error ? error.message : String(error)
    });
    // Clear any existing set spans
    const cardTitleEl = document.getElementById('card-title');
    if (cardTitleEl) {
      const existingSetSpans = cardTitleEl.querySelectorAll('.card-title-set');
      existingSetSpans.forEach(span => span.remove());
    }
  }
}
