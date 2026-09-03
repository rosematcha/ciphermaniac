/**
 * Tier-plate palette.
 *
 * Hand-tuned, not generated. Two generated attempts failed the same way: a hue
 * sweep at one lightness went muddy, and letting lightness follow the hue fixed
 * the muddiness but still read as arithmetic rather than as colour someone
 * chose. These come from two palettes that already solve this exact problem —
 * a warm-paper ground with earthy accents:
 *
 * - Gruvbox (morhetz/gruvbox), the "neutral" accents as `vivid` — the working
 *   register, and where the default ramp comes from. Everforest's light accents
 *   sat here first and read shrill: they are tuned as syntax *foreground*
 *   colours on cream, and a 124px plate is a very different job from a keyword.
 *   Gruvbox's mid-tones are warmer, sit down into the paper, and give a red
 *   that reads as brick rather than as an alert.
 * - Gruvbox's "faded" accents as `deep`.
 * - Everforest (sainnhe/everforest) dark accents as `soft`, the quiet register.
 * - Gruvbox greys as `neutral`, for a deliberately colourless tier.
 *
 * Several hues needed nudging out of the band where a fill is too dark for ink
 * text and too light for paper text — `neutral_orange` #d65d0e, `neutral_blue`
 * #458588 and `neutral_purple` #b16286 all land there, as do `faded_yellow`
 * #b57614 and `faded_green` #79740e. Each was stepped away from the crossover
 * rather than swapped for a different hue.
 *
 * Every swatch carries the text colour it was verified against; the test suite
 * re-asserts the whole set at ≥4.5:1 so a future edit cannot quietly break one.
 * @module pages/tierList/palette
 */

/** Which register a swatch belongs to. Registers are exhausted in this order. */
export type SwatchTone = 'vivid' | 'soft' | 'deep' | 'neutral';

export interface Swatch {
  /** Stable id, `tone-hue`. This is what a tier stores. */
  id: string;
  tone: SwatchTone;
  hex: string;
  /** Ink or paper, whichever clears AA against `hex`. */
  text: string;
}

/** Ink and paper, matching `--fg` and `--surface` in light mode. */
export const INK = '#1f1a13';
export const PAPER = '#fbf5e6';

export const SWATCHES: readonly Swatch[] = [
  { id: 'vivid-red', tone: 'vivid', hex: '#cc241d', text: PAPER },
  { id: 'vivid-orange', tone: 'vivid', hex: '#de7018', text: INK },
  { id: 'vivid-yellow', tone: 'vivid', hex: '#d79921', text: INK },
  { id: 'vivid-sage', tone: 'vivid', hex: '#b0a63a', text: INK },
  { id: 'vivid-green', tone: 'vivid', hex: '#98971a', text: INK },
  { id: 'vivid-aqua', tone: 'vivid', hex: '#689d6a', text: INK },
  { id: 'vivid-blue', tone: 'vivid', hex: '#5ca0a6', text: INK },
  { id: 'vivid-slate', tone: 'vivid', hex: '#7099a8', text: INK },
  { id: 'vivid-purple', tone: 'vivid', hex: '#c4829f', text: INK },
  { id: 'soft-red', tone: 'soft', hex: '#e67e80', text: INK },
  { id: 'soft-orange', tone: 'soft', hex: '#e69875', text: INK },
  { id: 'soft-yellow', tone: 'soft', hex: '#dbbc7f', text: INK },
  { id: 'soft-green', tone: 'soft', hex: '#a7c080', text: INK },
  { id: 'soft-sage', tone: 'soft', hex: '#b9c99a', text: INK },
  { id: 'soft-aqua', tone: 'soft', hex: '#83c092', text: INK },
  { id: 'soft-blue', tone: 'soft', hex: '#7fbbb3', text: INK },
  { id: 'soft-slate', tone: 'soft', hex: '#a2b0bf', text: INK },
  { id: 'soft-purple', tone: 'soft', hex: '#d699b6', text: INK },
  { id: 'deep-red', tone: 'deep', hex: '#9d0006', text: PAPER },
  { id: 'deep-orange', tone: 'deep', hex: '#af3a03', text: PAPER },
  { id: 'deep-yellow', tone: 'deep', hex: '#d79921', text: INK },
  { id: 'deep-green', tone: 'deep', hex: '#63600b', text: PAPER },
  { id: 'deep-sage', tone: 'deep', hex: '#5f6b1e', text: PAPER },
  { id: 'deep-aqua', tone: 'deep', hex: '#427b58', text: PAPER },
  { id: 'deep-blue', tone: 'deep', hex: '#076678', text: PAPER },
  { id: 'deep-slate', tone: 'deep', hex: '#3c5a66', text: PAPER },
  { id: 'deep-purple', tone: 'deep', hex: '#8f3f71', text: PAPER },
  { id: 'neutral-bone', tone: 'neutral', hex: '#d5c4a1', text: INK },
  { id: 'neutral-stone', tone: 'neutral', hex: '#a89984', text: INK },
  { id: 'neutral-ash', tone: 'neutral', hex: '#928374', text: INK },
  { id: 'neutral-slate', tone: 'neutral', hex: '#6f635a', text: PAPER }
];

const BY_ID = new Map(SWATCHES.map(s => [s.id, s]));

/** Falls back to stone so an unknown id from a shared URL still renders. */
export function swatch(id: string): Swatch {
  return BY_ID.get(id) ?? BY_ID.get('neutral-stone')!;
}

/**
 * The default six: brick, burnt orange, mustard, olive, sage green, taupe.
 *
 * Hue travel is deliberately short and the descent is carried by saturation and
 * lightness instead. A red→orange→yellow→green→teal ramp is a spectrum, and a
 * spectrum reads as decoration rather than as a ranking; these six sit in one
 * family and still separate cleanly row to row.
 */
export const DEFAULT_RAMP: readonly string[] = [
  'vivid-red',
  'vivid-orange',
  'vivid-yellow',
  'vivid-green',
  'vivid-aqua',
  'neutral-ash'
];

export const DEFAULT_TIER_NAMES: readonly string[] = ['S', 'A', 'B', 'C', 'D', 'F'];

/**
 * Order in which an added tier picks its colour.
 *
 * Each register is walked at a stride of 4 over its nine hues. Nine and four
 * are coprime, so every hue is still used exactly once, but consecutive tiers
 * land far apart on the wheel instead of adjacent — walking in hue order gave a
 * tidy ramp at six tiers and put two near-identical reds beside each other at
 * fourteen. Hues already spoken for by the default ramp are skipped so an added
 * tier never collides with one.
 */
const STRIDE = 4;

function walk(tone: SwatchTone, taken: ReadonlySet<string>): string[] {
  const set = SWATCHES.filter(s => s.tone === tone);
  return set.map((_, i) => set[(i * STRIDE) % set.length]!.id).filter(id => !taken.has(id));
}

export const AUTO_ORDER: readonly string[] = (() => {
  const taken = new Set(DEFAULT_RAMP);
  return [
    ...walk('vivid', taken),
    ...walk('deep', taken),
    ...walk('soft', taken),
    ...SWATCHES.filter(s => s.tone === 'neutral' && !taken.has(s.id)).map(s => s.id)
  ];
})();

/** The first colour no existing tier is using, so a new tier is legible on arrival. */
export function nextSwatchId(used: Iterable<string>): string {
  const taken = new Set(used);
  return AUTO_ORDER.find(id => !taken.has(id)) ?? 'neutral-stone';
}
