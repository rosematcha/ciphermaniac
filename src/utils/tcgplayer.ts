const PARTNER_URL = 'https://partner.tcgplayer.com/c/6491809/1780961/21018';
const SHOP_ORIGINS = new Set(['https://www.tcgplayer.com', 'https://tcgplayer.com']);

/** Preserve the shopping destination while routing the click through Impact. */
export function tcgplayerAffiliateUrl(destination: string): string {
  const target = new URL(destination);
  if (!SHOP_ORIGINS.has(target.origin) || target.username || target.password) {
    throw new Error('Expected a TCGplayer shopping URL');
  }
  const affiliate = new URL(PARTNER_URL);
  affiliate.searchParams.set('u', target.href);
  return affiliate.href;
}
