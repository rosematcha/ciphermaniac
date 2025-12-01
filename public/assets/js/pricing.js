/**
 * Client-side pricing module for Ciphermaniac
 * Fetches and caches TCGCSV pricing data
 */
export class PricingManager {
    priceData;
    lastFetch;
    cacheExpiry;
    constructor(cacheExpiryMs = 60 * 60 * 1000) {
        this.priceData = null;
        this.lastFetch = null;
        this.cacheExpiry = cacheExpiryMs;
    }
    async getCardPrice(cardName, setCode, cardNumber) {
        await this.ensurePriceData();
        const entry = this.lookupCard(cardName, setCode, cardNumber);
        return entry?.price ?? null;
    }
    async getCardTCGPlayerId(cardName, setCode, cardNumber) {
        await this.ensurePriceData();
        const entry = this.lookupCard(cardName, setCode, cardNumber);
        return entry?.tcgPlayerId ?? null;
    }
    async getCardData(cardName, setCode, cardNumber) {
        await this.ensurePriceData();
        return this.lookupCard(cardName, setCode, cardNumber) ?? null;
    }
    async getMultiplePrices(cards) {
        await this.ensurePriceData();
        const prices = {};
        for (const card of cards) {
            const paddedNumber = card.number.padStart(3, '0');
            const key = `${card.name}::${card.set}::${paddedNumber}`;
            const entry = this.priceData?.cardPrices?.[key];
            if (entry !== undefined) {
                prices[key] = entry.price;
            }
        }
        return prices;
    }
    async getPricingMetadata() {
        await this.ensurePriceData();
        if (!this.priceData) {
            return null;
        }
        return {
            lastUpdated: this.priceData.lastUpdated || 'unknown',
            updateSource: this.priceData.updateSource || 'unknown',
            cardCount: this.priceData.cardCount || (this.priceData.cardPrices ? Object.keys(this.priceData.cardPrices).length : 0)
        };
    }
    async ensurePriceData() {
        const now = Date.now();
        if (this.priceData && this.lastFetch && now - this.lastFetch < this.cacheExpiry) {
            return;
        }
        await this.fetchPriceData();
    }
    async fetchPriceData() {
        const response = await fetch('/api/get-prices');
        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }
        const data = (await response.json());
        if (data.error) {
            throw new Error(data.message || data.error);
        }
        this.priceData = data;
        this.lastFetch = Date.now();
    }
    clearCache() {
        this.priceData = null;
        this.lastFetch = null;
    }
    lookupCard(cardName, setCode, cardNumber) {
        const paddedNumber = cardNumber.padStart(3, '0');
        const key = `${cardName}::${setCode}::${paddedNumber}`;
        return this.priceData?.cardPrices?.[key];
    }
}
if (typeof window !== 'undefined') {
    window.pricingManager = new PricingManager();
}
export default PricingManager;
