/**
 * pokemontcg.io image source for vintage sets.
 *
 * Limitless's CDN carries scans back through the HGSS era only; everything
 * older (DP era and before), the POP series, and XY promos have no art there,
 * so those set codes map to pokemontcg.io set ids instead. Every entry below
 * was verified by fetching a sample card from api.pokemontcg.io and matching
 * its name against our synonym DB (2026-07-21).
 *
 * Unlike the Limitless CDN, images.pokemontcg.io hotlinks cleanly — no
 * bot-management cookie — so a direct URL loads in the browser. It sends no
 * `Access-Control-Allow-Origin`, though, and an image the page cannot re-read
 * cannot be inlined into a canvas or a rasterised DOM snapshot: every vintage
 * print came back as an empty frame in the tier list's JPG. So the art is
 * served through the same-origin proxy first, exactly like the Limitless
 * scans, and the direct URLs stay behind it as a fallback for display.
 * @module utils/ptcgio
 */

export type PtcgioSize = 'xs' | 'sm' | 'lg';

/** Limitless set code → pokemontcg.io set id, vintage sets only. */
const PTCGIO_SET_IDS: Record<string, string> = {
  // Base era
  BS: 'base1',
  JU: 'base2',
  FO: 'base3',
  BS2: 'base4',
  LC: 'base6',
  G1: 'gym1',
  G2: 'gym2',
  N1: 'neo1',
  // e-Card era
  E1: 'ecard1',
  E2: 'ecard2',
  // EX era
  RS: 'ex1',
  SS: 'ex2',
  RG: 'ex6',
  EM: 'ex9',
  UF: 'ex10',
  DS: 'ex11',
  HP: 'ex13',
  CG: 'ex14',
  DF: 'ex15',
  PK: 'ex16',
  // DP / Platinum era
  DP: 'dp1',
  MT: 'dp2',
  SW: 'dp3',
  GE: 'dp4',
  MD: 'dp5',
  SF: 'dp7',
  PL: 'pl1',
  // POP series + XY promos
  P5: 'pop5',
  P8: 'pop8',
  XYP: 'xyp'
};

const PTCGIO_BASE = 'https://images.pokemontcg.io';
/** Same-origin route in front of {@link PTCGIO_BASE}. See functions/thumbnails. */
const PTCGIO_PROXY = '/thumbnails/ptcgio';

/** True when the set's art must come from pokemontcg.io (absent on Limitless). */
export function hasPtcgioImages(setCode: string): boolean {
  return Object.hasOwn(PTCGIO_SET_IDS, setCode.toUpperCase());
}

/**
 * pokemontcg.io card numbers strip our zero-padding (base1/94, not 094);
 * XY promos additionally carry an XY prefix (xyp/XY27).
 */
function ptcgioNumber(setCode: string, number: string | number): string {
  const raw = String(number).trim();
  const match = raw.match(/^0*(\d+)([A-Za-z]*)$/);
  const stripped = match ? `${match[1]}${match[2]}` : raw;
  return setCode.toUpperCase() === 'XYP' ? `XY${stripped}` : stripped;
}

/**
 * Candidate image URLs for a vintage print, best first. The plain scan
 * (~245px wide) covers the strip thumbnails; `lg` leads with the ~735px
 * hi-res for the hero art and keeps the plain scan as fallback.
 * @param setCode - Limitless set code (e.g. "BS")
 * @param number - Card number, padded or not
 * @param size - Rendering tier
 * @returns URLs to try in order, or [] for sets pokemontcg.io doesn't back
 */
export function ptcgioImageUrls(setCode: string, number: string | number, size: PtcgioSize): string[] {
  const id = PTCGIO_SET_IDS[setCode.toUpperCase()];
  if (!id) {
    return [];
  }
  const name = ptcgioNumber(setCode, number);
  // Hi-res first for the hero, the ~245px scan first for thumbnails.
  const files = size === 'lg' ? [`${name}_hires`, name] : [name, `${name}_hires`];
  return [
    ...files.map(file => `${PTCGIO_PROXY}/${id}/${file}`),
    ...files.map(file => `${PTCGIO_BASE}/${id}/${file}.png`)
  ];
}

/**
 * srcset over both pokemontcg.io scans so the browser picks the cheapest
 * sufficient one (mirrors CardImage's Limitless-tier srcset).
 * @param setCode - Limitless set code
 * @param number - Card number, padded or not
 * @returns srcset string, or null for unmapped sets
 */
export function ptcgioSrcset(setCode: string, number: string | number): string | null {
  const id = PTCGIO_SET_IDS[setCode.toUpperCase()];
  if (!id) {
    return null;
  }
  // Proxy-only: a srcset has no error fallback, and the direct URLs are the
  // ones an export cannot read.
  const base = `${PTCGIO_PROXY}/${id}/${ptcgioNumber(setCode, number)}`;
  return `${base} 245w, ${base}_hires 735w`;
}
