/**
 * Geometry and timing for the card wall.
 *
 * Pure: no canvas, no DOM. The page owns pixels; this owns which cards land in
 * which row, how big they are, where they sit at a given moment, and — the part
 * that actually constrains the design — how long one seamless loop takes.
 *
 * The seamless-loop rule is the reason the controls are shaped the way they
 * are. A row wraps cleanly only when it travels a whole number of tile widths
 * over the loop, which ties loop length, tile width and scroll speed together —
 * pick any two and the third is decided. Loop length is the one the user is
 * given, because it is the one with consequences: it sets the frame count, and
 * so the size of the file. A lap-1 row crosses its tile exactly once in that
 * time, faster rows cross it a whole number of times, and scroll speed is
 * whatever falls out. Adding cards to a row therefore makes it scroll faster
 * rather than making the loop longer.
 *
 * Everything is expressed relative to card width, so a scene built at 640x360
 * is the same scene as one built at 1920x1080 — which is what lets the export
 * render at a different size than the preview.
 * @module src/lib/cardWall/scene
 */

import type { WallCard } from './roster';

export type Direction = 'left' | 'right';

/** Trading-card proportions, matching `.card-image-real` on the rest of the site. */
export const CARD_ASPECT = 5 / 7;

/** Per-row controls. One entry per visible row. */
export interface RowSetting {
  direction: Direction;
  /** Whole tile widths travelled per loop. Integer, or the loop seams. */
  laps: number;
}

export interface WallConfig {
  rows: number;
  /** Cards in one tile. The tile repeats across the row for as wide as the stage is. */
  cardsPerRow: number;
  /** How long one seamless loop lasts. The frame count, and the file, follow from this. */
  loopSeconds: number;
  /** Space between cards, as a fraction of card width. */
  gap: number;
  /** Card height as a fraction of its row band. */
  cardScale: number;
  rowSettings: readonly RowSetting[];
  /** Shuffle seed, so a wall you like can be returned to. */
  seed: number;
}

export interface SceneRow {
  cards: readonly WallCard[];
  direction: Direction;
  laps: number;
  /** Card top edge, in pixels from the top of the stage. */
  y: number;
  /** Starting displacement, so rows don't all begin flush at t=0. */
  phase: number;
}

export interface WallScene {
  rows: readonly SceneRow[];
  cardWidth: number;
  cardHeight: number;
  gapPx: number;
  /** Width of one repeat of a row's card sequence. */
  tileWidth: number;
  loopSeconds: number;
  /** Derived scroll rate of a lap-1 row, in card widths per second. Readout only. */
  cardsPerSecond: number;
}

/** mulberry32 — small, seedable, and good enough to deal cards with. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates against a seeded source, so the same seed deals the same wall. */
export function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Deal the roster into rows.
 *
 * Concatenated independent shuffles rather than one shuffle read cyclically:
 * when the wall wants more slots than the roster has cards, cycling would make
 * every row after the first repeat the previous row's run in the same order,
 * which reads as an obvious loop. Reshuffling each pass keeps the repeats
 * scattered.
 */
export function dealRows(
  roster: readonly WallCard[],
  rows: number,
  cardsPerRow: number,
  rng: () => number
): WallCard[][] {
  const needed = rows * cardsPerRow;
  const pool: WallCard[] = [];
  while (pool.length < needed) {
    pool.push(...shuffled(roster, rng));
  }
  const out: WallCard[][] = [];
  for (let i = 0; i < rows; i++) {
    out.push(pool.slice(i * cardsPerRow, (i + 1) * cardsPerRow));
  }
  return out;
}

/** Build the scene for a stage of the given pixel size. */
export function buildScene(config: WallConfig, roster: readonly WallCard[], width: number, height: number): WallScene {
  const rows = Math.max(1, Math.floor(config.rows));
  const cardsPerRow = Math.max(1, Math.floor(config.cardsPerRow));
  const band = height / rows;
  const cardHeight = band * config.cardScale;
  const cardWidth = cardHeight * CARD_ASPECT;
  const gapPx = cardWidth * config.gap;
  const tileWidth = cardsPerRow * (cardWidth + gapPx);
  // A lap-1 row crosses exactly one tile in the loop, so the loop the user asked
  // for is what sets the pace. Card widths per second rather than pixels keeps
  // the figure meaningful at any output size.
  const loopSeconds = Math.max(0.1, config.loopSeconds);
  const cardsPerSecond = tileWidth / (cardWidth * loopSeconds);

  const hands = dealRows(roster, rows, cardsPerRow, createRng(config.seed));
  // Phases come off their own stream. Sharing one with the deal would make them
  // depend on how many draws the deal happened to consume, so nudging
  // cards-per-row would also re-stagger every row for no reason the user asked for.
  const phaseRng = createRng(config.seed ^ 0x9e3779b9);
  const sceneRows: SceneRow[] = hands.map((cards, i) => {
    const setting = config.rowSettings[i] ?? { direction: i % 2 === 0 ? 'left' : 'right', laps: 1 };
    return {
      cards,
      direction: setting.direction,
      laps: Math.max(1, Math.round(setting.laps)),
      y: band * i + (band - cardHeight) / 2,
      phase: phaseRng() * tileWidth
    };
  });

  return { rows: sceneRows, cardWidth, cardHeight, gapPx, tileWidth, loopSeconds, cardsPerSecond };
}

/**
 * Left edge of the row's first tile at time `t`, normalized into
 * `[-tileWidth, 0)` so callers only ever tile rightwards from it.
 *
 * At `t === loopSeconds` the travel term has grown by a whole number of tile
 * widths, so this returns exactly what it did at `t === 0`. That identity is
 * the whole seamless-loop guarantee.
 */
export function tileOriginX(row: SceneRow, tileWidth: number, loopSeconds: number, t: number): number {
  const travel = (t / loopSeconds) * row.laps * tileWidth + row.phase;
  const signed = row.direction === 'left' ? -travel : travel;
  const wrapped = ((signed % tileWidth) + tileWidth) % tileWidth;
  return wrapped - tileWidth;
}

/**
 * Per-frame delays in centiseconds, GIF's only time unit.
 *
 * Rounding each frame independently would drift — 30fps wants 3.33cs and would
 * land on 3, running the loop 11% fast. Accumulating against the exact total
 * instead spreads the remainder (3,3,4,3,3,4...) so the loop lasts precisely as
 * long as the preview did. Two centiseconds is the floor because renderers
 * silently rewrite anything faster to 10.
 */
export function planFrameDelays(loopSeconds: number, frameCount: number): number[] {
  const totalCs = loopSeconds * 100;
  const delays: number[] = [];
  let emitted = 0;
  for (let i = 1; i <= frameCount; i++) {
    const target = Math.round((i * totalCs) / frameCount);
    delays.push(Math.max(2, target - emitted));
    emitted = target;
  }
  return delays;
}
