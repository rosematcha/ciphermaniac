/**
 * Card data utilities and processing functions
 * @module card/data
 */

import { buildCardIndexFromMaster, fetchReport, fetchTournamentsList, getCardPrice } from '../api.js';
import { parseReport } from '../parse.js';
import { getBaseName, getCanonicalId, getDisplayName, parseDisplayName } from './identifiers.js';
import { extractSetAndNumber } from './routing.js';
import { ErrorBoundary, logger, validators } from '../utils/errorHandler.js';

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
    // Prune expired entries and enforce max size to prevent localStorage quota errors
    const VARIANTS_CACHE_MAX = 200;
    const now = Date.now();
    const keys = Object.keys(variantsCache);
    for (const k of keys) {
      if (now - (variantsCache[k]?.timestamp || 0) >= CACHE_EXPIRY) {
        delete variantsCache[k];
      }
    }
    const remaining = Object.keys(variantsCache);
    if (remaining.length >= VARIANTS_CACHE_MAX) {
      for (const k of remaining.slice(0, remaining.length - VARIANTS_CACHE_MAX + 1)) {
        delete variantsCache[k];
      }
    }
    variantsCache[cacheKey] = {
      variants: variantsList,
      timestamp: now
    };
    localStorage.setItem(VARIANTS_CACHE_KEY, JSON.stringify(variantsCache));
  } catch {
    // Ignore cache storage errors
  }

  return variantsList.sort();
}

/**
 * Result from searching for a card in a report
 */
export interface CardInReportResult {
  pct: number;
  found: number;
  total: number;
  dist: any[];
  meta: any;
  /** The card name resolved from the report (useful when identifier was an unresolved slug) */
  resolvedName?: string;
}

/**
 * Search for a card in a fetched report, combining data across all variants.
 * Shared helper used by both physical tournament lookups and online meta lookups.
 * @param reportData - Raw report data (from fetchReport)
 * @param identifier - The card identifier to search for
 * @param variants - Pre-resolved card variants (from getCardVariants)
 * @param _canonicalName - Canonical card name (from getCanonicalCard) for display
 * @returns CardInReportResult if found, null otherwise
 */
export function findCardInReport(
  reportData: any,
  identifier: string,
  variants: string[],
  _canonicalName: string | null
): CardInReportResult | null {
  const parsed = parseReport(reportData);
  if (!parsed || !Array.isArray(parsed.items)) {
    return null;
  }

  // 1) Try base-name index lookup first (works for trainers and base Pokemon names)
  const hasUID = identifier.includes('::');
  if (!hasUID) {
    const idx = buildCardIndexFromMaster(reportData);
    const baseName = getBaseName(identifier) || '';
    if (baseName) {
      const matchingKey = Object.keys(idx.cards || {}).find(k => k.toLowerCase() === baseName.toLowerCase()) || '';
      const entry = idx.cards?.[baseName] || idx.cards?.[matchingKey];
      if (entry) {
        const card: any = {
          name: baseName,
          found: entry.found,
          total: entry.total,
          pct: entry.pct,
          dist: entry.dist
        };
        // Enrich with metadata from raw items
        const rawItem = parsed.items.find((it: any) => it.name?.toLowerCase() === baseName.toLowerCase());
        if (rawItem) {
          card.category = rawItem.category;
          card.trainerType = rawItem.trainerType;
          card.energyType = rawItem.energyType;
          card.aceSpec = rawItem.aceSpec;
          card.regulationMark = rawItem.regulationMark;
          card.supertype = rawItem.supertype;
          card.rank = rawItem.rank;
        }
        return {
          pct: Number.isFinite(card.pct) ? card.pct : card.total ? (100 * card.found) / card.total : 0,
          found: card.found,
          total: card.total,
          dist: card.dist || [],
          meta: {
            category: card.category,
            trainerType: card.trainerType,
            energyType: card.energyType,
            aceSpec: card.aceSpec,
            regulationMark: card.regulationMark,
            supertype: card.supertype,
            rank: card.rank
          }
        };
      }
    }
  }

  // 2) Variant-combining lookup
  let combinedFound = 0;
  let combinedTotal: number | null = null;
  let hasAnyData = false;
  const combinedDist: any[] = [];
  let firstVariantCard: any = null;

  for (const variant of variants) {
    const variantCard = findCard(parsed.items, variant);
    if (variantCard) {
      hasAnyData = true;
      if (!firstVariantCard) {
        firstVariantCard = variantCard;
      }
      if (Number.isFinite(variantCard.found)) {
        combinedFound += variantCard.found;
      }
      if (combinedTotal === null && Number.isFinite(variantCard.total)) {
        combinedTotal = variantCard.total;
      }
      if (variantCard.dist && Array.isArray(variantCard.dist)) {
        for (const distEntry of variantCard.dist) {
          const existing = combinedDist.find(distItem => distItem.copies === distEntry.copies);
          if (existing) {
            existing.players += distEntry.players || 0;
          } else {
            combinedDist.push({ copies: distEntry.copies, players: distEntry.players || 0 });
          }
        }
      }
    }
  }

  if (hasAnyData && combinedTotal !== null) {
    const pct = combinedTotal > 0 ? (100 * combinedFound) / combinedTotal : 0;
    return {
      pct,
      found: combinedFound,
      total: combinedTotal,
      dist: combinedDist.sort((a: any, b: any) => a.copies - b.copies),
      meta: firstVariantCard
        ? {
            category: firstVariantCard.category,
            trainerType: firstVariantCard.trainerType,
            energyType: firstVariantCard.energyType,
            aceSpec: firstVariantCard.aceSpec,
            regulationMark: firstVariantCard.regulationMark,
            supertype: firstVariantCard.supertype,
            rank: firstVariantCard.rank
          }
        : {}
    };
  }

  // 3) Direct set+number scan — handles unresolved slugs like "POR~062"
  //    that couldn't be resolved to a card name via physical tournaments
  const { set: searchSet, number: searchNumber } = extractSetAndNumber(identifier);
  if (searchSet && searchNumber) {
    const normalizedSet = searchSet.toUpperCase();
    const normalizedNumber = searchNumber.replace(/^0+/, ''); // strip leading zeros
    const match = parsed.items.find((item: any) => {
      const itemSet = (item.set || '').toUpperCase();
      const itemNumber = String(item.number || '').replace(/^0+/, '');
      // Check UID format (Name::SET::NUMBER)
      if (item.uid) {
        const parts = item.uid.split('::');
        if (parts.length >= 3) {
          const uidSet = (parts[1] || '').toUpperCase().trim();
          const uidNum = (parts[2] || '').trim().replace(/^0+/, '');
          if (uidSet === normalizedSet && uidNum === normalizedNumber) {
            return true;
          }
        }
      }
      return itemSet === normalizedSet && itemNumber === normalizedNumber;
    });

    if (match) {
      const matchPct = Number.isFinite(match.pct)
        ? match.pct
        : match.total
          ? (100 * (match.found || 0)) / match.total
          : 0;
      // Build a display name from the matched item
      const resolvedName = match.name
        ? match.set && match.number
          ? `${match.name} ${match.set} ${match.number}`
          : match.name
        : undefined;
      return {
        pct: matchPct,
        found: match.found || 0,
        total: match.total || 0,
        dist: match.dist || [],
        resolvedName,
        meta: {
          category: match.category,
          trainerType: match.trainerType,
          energyType: match.energyType,
          aceSpec: match.aceSpec,
          regulationMark: match.regulationMark,
          supertype: match.supertype,
          rank: match.rank
        }
      };
    }
  }

  return null;
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
