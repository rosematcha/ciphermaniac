/**
 * Card data utilities and processing functions
 * @module card/data
 */
import { fetchReport, fetchTournamentsList, getCardPrice } from '../api.js';
import { parseReport } from '../parse.js';
import { getBaseName, getCanonicalId, getDisplayName, parseDisplayName } from './identifiers.js';
import { ErrorBoundary, logger, validators } from '../utils/errorHandler.js';
/**
 * Find a card in items array by identifier
 * @param items - Array of card items
 * @param cardIdentifier - Card identifier to search for
 * @returns Found card item or null
 */
export function findCard(items, cardIdentifier) {
    try {
        // Enhanced input validation
        const validatedIdentifier = validators.cardIdentifier(cardIdentifier);
        validators.array(items);
        logger.debug('findCard called', {
            cardIdentifier: validatedIdentifier,
            itemsCount: items.length
        });
    }
    catch (error) {
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
        const baseName = getBaseName(getCanonicalId(item));
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
export async function collectCardVariants(cardIdentifier) {
    let validatedIdentifier;
    let searchBaseName;
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
    }
    catch (error) {
        logger.warn('collectCardVariants validation failed', {
            cardIdentifier,
            error: error.message
        });
        return [];
    }
    // Use aggressive caching for variants to avoid repeated network calls
    const VARIANTS_CACHE_KEY = 'cardVariantsV2';
    const CACHE_EXPIRY = 1000 * 60 * 60 * 24; // 24 hours
    let variantsCache;
    try {
        variantsCache = JSON.parse(localStorage.getItem(VARIANTS_CACHE_KEY) || '{}');
    }
    catch {
        variantsCache = {};
    }
    const cacheKey = searchBaseName.toLowerCase();
    const cachedEntry = variantsCache[cacheKey];
    // Return cached data if fresh
    if (cachedEntry && Date.now() - cachedEntry.timestamp < CACHE_EXPIRY) {
        return cachedEntry.variants.sort();
    }
    const variants = new Set();
    let tournaments = [];
    try {
        const list = await fetchTournamentsList();
        tournaments = Array.isArray(list) ? list : [];
    }
    catch {
        tournaments = ['2025-08-15, World Championships 2025'];
    }
    if (!Array.isArray(tournaments) || tournaments.length === 0) {
        tournaments = ['2025-08-15, World Championships 2025'];
    }
    // Optimize for performance: limit to recent tournaments for variants collection
    // Most card variants appear across multiple recent tournaments
    const RECENT_LIMIT = 4; // Check only the 4 most recent tournaments for variants
    const recentTournaments = tournaments.slice(0, RECENT_LIMIT);
    // Parallelize tournament data collection with higher concurrency since we're processing fewer tournaments
    const promises = recentTournaments.map(async (tournament) => {
        try {
            const master = await fetchReport(tournament);
            const parsed = parseReport(master);
            const tournamentVariants = new Set();
            for (const item of parsed.items) {
                const canonicalId = getCanonicalId(item);
                const itemBaseName = getBaseName(canonicalId);
                if (itemBaseName && itemBaseName.toLowerCase() === searchBaseName.toLowerCase()) {
                    // Add canonical display name
                    const displayName = getDisplayName(canonicalId);
                    if (displayName) {
                        tournamentVariants.add(displayName);
                    }
                }
            }
            return tournamentVariants;
        }
        catch {
            // Skip failed tournament loads
            return new Set();
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
    }
    catch {
        // Ignore cache storage errors
    }
    return variantsList.sort();
}
/**
 * Render card price information
 * @param cardIdentifier - Card identifier
 */
export async function renderCardPrice(cardIdentifier) {
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
    }
    catch (error) {
        logger.exception('renderCardPrice failed', error, { cardIdentifier });
        showPriceError(priceContainer, 'Unable to load price data');
    }
}
/**
 * Internal function to load and display price data
 * @param cardIdentifier - Validated card identifier
 * @param container - Price container element
 */
async function loadAndDisplayPrice(cardIdentifier, container) {
    const priceElement = container;
    let price = null;
    // If cardIdentifier is already in UID format (Name::SET::NUMBER), use it directly
    if (cardIdentifier.includes('::')) {
        logger.debug('Direct UID lookup', { cardIdentifier });
        price = await getCardPrice(cardIdentifier);
    }
    else {
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
        }
        catch (variantError) {
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
    }
    else {
        showPriceUnavailable(priceElement, 'Price data not available');
        logger.debug('No price found', { cardIdentifier });
    }
}
/**
 * Show price information in container
 * @param container - Container element
 * @param price - Price to display
 */
function showPrice(container, price) {
    const priceElement = document.createElement('div');
    priceElement.className = 'price-info';
    priceElement.innerHTML = `
    <div class="price-label">Market Price:</div>
    <div class="price-value">$${price.toFixed(2)}</div>
  `;
    container.appendChild(priceElement);
}
/**
 * Show price unavailable message
 * @param container - Container element
 * @param message - Message to display
 */
function showPriceUnavailable(container, message) {
    const noPriceElement = document.createElement('div');
    noPriceElement.className = 'price-info no-price';
    noPriceElement.textContent = message;
    container.appendChild(noPriceElement);
}
/**
 * Show price error message
 * @param container - Container element
 * @param message - Error message to display
 */
function showPriceError(container, message) {
    const errorElement = document.createElement('div');
    errorElement.className = 'price-info error';
    errorElement.textContent = message;
    container.appendChild(errorElement);
}
/**
 * Render card sets/variants information
 * @param cardIdentifier - Card identifier
 */
export async function renderCardSets(cardIdentifier) {
    const setsContainer = document.getElementById('card-sets');
    if (!setsContainer) {
        logger.debug('renderCardSets: sets container not found');
        return;
    }
    try {
        const validatedIdentifier = validators.cardIdentifier(cardIdentifier);
        logger.debug('renderCardSets started', {
            cardIdentifier: validatedIdentifier
        });
        const errorBoundary = new ErrorBoundary(setsContainer, {
            showRetryButton: false,
            showErrorDetails: false
        });
        await errorBoundary.execute(async () => {
            const variants = await collectCardVariants(validatedIdentifier);
            setsContainer.className = '';
            if (variants.length === 0) {
                setsContainer.textContent = '';
                logger.debug('No variants found', {
                    cardIdentifier: validatedIdentifier
                });
                return;
            }
            setsContainer.textContent = variants.join(', ');
            logger.debug('Variants displayed', {
                cardIdentifier: validatedIdentifier,
                variantCount: variants.length
            });
        }, null, { loadingMessage: 'Loading variants...', retryAttempts: 1 });
    }
    catch (error) {
        logger.exception('renderCardSets failed', error, { cardIdentifier });
        // Set error state atomically
        Object.assign(setsContainer, {
            className: 'error',
            textContent: ''
        });
    }
}
