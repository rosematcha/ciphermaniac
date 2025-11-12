/**
 * Client-side pricing module for Ciphermaniac
 * Fetches and caches TCGCSV pricing data
 */

/**
 * Manages pricing data for Pokemon cards
 */
class PricingManager {
  constructor() {
    this.priceData = null;
    this.lastFetch = null;
    this.cacheExpiry = 60 * 60 * 1000; // 1 hour cache
  }

  /**
   * Get current price for a card
   * @param {string} cardName - Card name
   * @param {string} setCode - Set abbreviation (SVI, PAL, etc.)
   * @param {string} cardNumber - Card number (padded to 3 digits)
   * @returns {Promise<number|null>} Price in USD or null if not found
   */
  async getCardPrice(cardName, setCode, cardNumber) {
    await this.ensurePriceData();

    if (!this.priceData || !this.priceData.cardPrices) {
      return null;
    }

    // Format the key to match our pricing data structure
    const paddedNumber = cardNumber.padStart(3, '0');
    const cardKey = `${cardName}::${setCode}::${paddedNumber}`;

    const cardData = this.priceData.cardPrices[cardKey];
    return cardData ? cardData.price : null;
  }

  /**
   * Get TCGPlayer ID for a card
   * @param {string} cardName - Card name
   * @param {string} setCode - Set abbreviation (SVI, PAL, etc.)
   * @param {string} cardNumber - Card number (padded to 3 digits)
   * @returns {Promise<string|null>} TCGPlayer ID or null if not found
   */
  async getCardTCGPlayerId(cardName, setCode, cardNumber) {
    await this.ensurePriceData();

    if (!this.priceData || !this.priceData.cardPrices) {
      return null;
    }

    // Format the key to match our pricing data structure
    const paddedNumber = cardNumber.padStart(3, '0');
    const cardKey = `${cardName}::${setCode}::${paddedNumber}`;

    const cardData = this.priceData.cardPrices[cardKey];
    return cardData ? cardData.tcgPlayerId : null;
  }

  /**
   * Get complete card data (price and TCGPlayer ID)
   * @param {string} cardName - Card name
   * @param {string} setCode - Set abbreviation (SVI, PAL, etc.)
   * @param {string} cardNumber - Card number (padded to 3 digits)
   * @returns {Promise<object | null>} Object with price and tcgPlayerId or null if not found
   */
  async getCardData(cardName, setCode, cardNumber) {
    await this.ensurePriceData();

    if (!this.priceData || !this.priceData.cardPrices) {
      return null;
    }

    // Format the key to match our pricing data structure
    const paddedNumber = cardNumber.padStart(3, '0');
    const cardKey = `${cardName}::${setCode}::${paddedNumber}`;

    const cardData = this.priceData.cardPrices[cardKey];
    return cardData || null;
  }

  /**
   * Get prices for multiple cards at once
   * @param {Array} cards - Array of {name, set, number} objects
   * @returns {Promise<object>} Object mapping card keys to prices
   */
  async getMultiplePrices(cards) {
    await this.ensurePriceData();

    if (!this.priceData || !this.priceData.cardPrices) {
      return {};
    }

    const prices = {};

    for (const card of cards) {
      const paddedNumber = card.number.padStart(3, '0');
      const cardKey = `${card.name}::${card.set}::${paddedNumber}`;
      const cardData = this.priceData.cardPrices[cardKey];

      if (cardData !== undefined) {
        prices[cardKey] = cardData.price;
      }
    }

    return prices;
  }

  /**
   * Get pricing metadata (last updated, source, etc.)
   * @returns {Promise<{ lastUpdated: string, updateSource: string, cardCount: number } | null>}
   */
  async getPricingMetadata() {
    await this.ensurePriceData();

    if (!this.priceData) {
      return null;
    }

    return {
      lastUpdated: this.priceData.lastUpdated,
      updateSource: this.priceData.updateSource,
      cardCount: Object.keys(this.priceData.cardPrices || {}).length
    };
  }

  /**
   * Format price as currency string
   * @param {number} price - Price in USD
   * @returns {string} Formatted price string
   */
  formatPrice(price) {
    if (price === null || price === undefined) {
      return 'N/A';
    }

    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2
    }).format(price);
  }

  /**
   * Ensure we have fresh price data
   */
  async ensurePriceData() {
    const now = Date.now();

    // Check if we need to fetch new data
    if (
      !this.priceData ||
      !this.lastFetch ||
      now - this.lastFetch > this.cacheExpiry
    ) {
      try {
        await this.fetchPriceData();
      } catch (error) {
        // Failed to fetch fresh price data, using cached data if available
      }
    }
  }

  /**
   * Fetch price data from API
   */
  async fetchPriceData() {
    const response = await fetch('/api/get-prices');

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(data.message || data.error);
    }

    this.priceData = data;
    this.lastFetch = Date.now();

    // Price data updated successfully
  }

  /**
   * Clear cached data and force fresh fetch on next request
   */
  clearCache() {
    this.priceData = null;
    this.lastFetch = null;
  }
}

// Create global instance
/** @type {Window & { pricingManager?: PricingManager }} */ (
  window
).pricingManager = new PricingManager();

export default PricingManager;
