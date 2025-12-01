/**
 * Client-side pricing module for Ciphermaniac
 * Fetches and caches TCGCSV pricing data
 */

interface CardPriceEntry {
  price?: number;
  tcgPlayerId?: string;
}

interface PricingPayload {
  cardPrices: Record<string, CardPriceEntry>;
  lastUpdated?: string;
  updateSource?: string;
  cardCount?: number;
  error?: string;
  message?: string;
}

interface CardLookup {
  name: string;
  set: string;
  number: string;
}

export class PricingManager {
  private priceData: PricingPayload | null;
  private lastFetch: number | null;
  private cacheExpiry: number;

  constructor(cacheExpiryMs = 60 * 60 * 1000) {
    this.priceData = null;
    this.lastFetch = null;
    this.cacheExpiry = cacheExpiryMs;
  }

  async getCardPrice(cardName: string, setCode: string, cardNumber: string): Promise<number | null> {
    await this.ensurePriceData();
    const entry = this.lookupCard(cardName, setCode, cardNumber);
    return entry?.price ?? null;
  }

  async getCardTCGPlayerId(cardName: string, setCode: string, cardNumber: string): Promise<string | null> {
    await this.ensurePriceData();
    const entry = this.lookupCard(cardName, setCode, cardNumber);
    return entry?.tcgPlayerId ?? null;
  }

  async getCardData(cardName: string, setCode: string, cardNumber: string): Promise<CardPriceEntry | null> {
    await this.ensurePriceData();
    return this.lookupCard(cardName, setCode, cardNumber) ?? null;
  }

  async getMultiplePrices(cards: CardLookup[]): Promise<Record<string, number | undefined>> {
    await this.ensurePriceData();

    const prices: Record<string, number | undefined> = {};
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

  async getPricingMetadata(): Promise<{ lastUpdated: string; updateSource: string; cardCount: number } | null> {
    await this.ensurePriceData();

    if (!this.priceData) {
      return null;
    }

    return {
      lastUpdated: this.priceData.lastUpdated || 'unknown',
      updateSource: this.priceData.updateSource || 'unknown',
      cardCount:
        this.priceData.cardCount || (this.priceData.cardPrices ? Object.keys(this.priceData.cardPrices).length : 0)
    };
  }

  async ensurePriceData(): Promise<void> {
    const now = Date.now();
    if (this.priceData && this.lastFetch && now - this.lastFetch < this.cacheExpiry) {
      return;
    }
    await this.fetchPriceData();
  }

  async fetchPriceData(): Promise<void> {
    const response = await fetch('/api/get-prices');

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = (await response.json()) as PricingPayload;

    if (data.error) {
      throw new Error(data.message || data.error);
    }

    this.priceData = data;
    this.lastFetch = Date.now();
  }

  clearCache(): void {
    this.priceData = null;
    this.lastFetch = null;
  }

  private lookupCard(cardName: string, setCode: string, cardNumber: string): CardPriceEntry | undefined {
    const paddedNumber = cardNumber.padStart(3, '0');
    const key = `${cardName}::${setCode}::${paddedNumber}`;
    return this.priceData?.cardPrices?.[key];
  }
}

if (typeof window !== 'undefined') {
  (window as Window & { pricingManager?: PricingManager }).pricingManager = new PricingManager();
}

export default PricingManager;
