/**
 * Where the R2 mirror (convert-card-images.ts) gets each tier of a card's art.
 * Split out so the choice is testable without running the mirror.
 */
import { ptcgioScanUrls } from '../src/utils/ptcgio';

const LIMITLESS_CDN = 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci';

export type Tier = 'XS' | 'SM' | 'LG';

/** Pixel width of each Limitless tier; vintage scans are resized to match. */
const TIER_WIDTHS: Record<Tier, number> = { XS: 136, SM: 274, LG: 460 };

export interface TierSource {
  /** Candidates in order; the next is tried only when one is genuinely absent. */
  urls: string[];
  /** Target width for a source that is not already cut to the tier. */
  width: number | null;
}

/**
 * Limitless publishes each tier pre-sized. The vintage sets it lacks have one
 * hi-res scan per card on pokemontcg.io (plain scan as fallback), resized so
 * the mirror's output matches the Limitless tiers under the same key.
 * @param set - Upper-case Limitless set code
 * @param number - Three-digit padded card number (e.g. "094")
 * @param tier - Target tier
 */
export function tierSource(set: string, number: string, tier: Tier): TierSource {
  const vintage = ptcgioScanUrls(set, number);
  if (vintage.length > 0) {
    return { urls: vintage, width: TIER_WIDTHS[tier] };
  }
  return { urls: [`${LIMITLESS_CDN}/${set}/${set}_${number}_R_EN_${tier}.png`], width: null };
}
