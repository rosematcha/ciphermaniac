/**
 * Paints one frame of the wall.
 *
 * Resolution-agnostic on purpose: the same config paints the on-screen preview
 * and the export canvas, so what you download is what you were looking at.
 * @module src/lib/cardWall/render
 */

import { type SceneRow, tileOriginX, type WallScene } from './scene';
import { cardKey, type WallImages } from './images';

export type Background = 'cream' | 'ink' | 'black';

export const BACKGROUND_FILL: Record<Background, string> = {
  cream: '#f4ecdb',
  ink: '#1a1816',
  black: '#000000'
};

export interface WallLook {
  background: Background;
  /** Blur radius in design units, scaled to the stage so exports match the preview. */
  blur: number;
  /** Black veil opacity, 0..1. */
  darken: number;
}

/** Blur is authored against a 1080-tall stage and scales from there. */
const BLUR_REFERENCE_HEIGHT = 1080;

function drawRow(
  ctx: CanvasRenderingContext2D,
  scene: WallScene,
  row: SceneRow,
  images: WallImages,
  t: number,
  left: number,
  right: number
): void {
  const { tileWidth, cardWidth, cardHeight, gapPx } = scene;
  // A degenerate stage (zero height, or mid-layout) collapses the tile to
  // nothing, and the copy loop below would then run to infinity and hang the
  // tab. There is nothing to draw in that case anyway.
  if (!(tileWidth > 0) || !(scene.loopSeconds > 0)) {
    return;
  }
  const origin = tileOriginX(row, tileWidth, scene.loopSeconds, t);
  const first = Math.floor((left - origin) / tileWidth);
  const last = Math.ceil((right - origin) / tileWidth);
  for (let copy = first; copy <= last; copy++) {
    const base = origin + copy * tileWidth;
    for (let i = 0; i < row.cards.length; i++) {
      const x = base + i * (cardWidth + gapPx);
      if (x > right || x + cardWidth < left) {
        continue;
      }
      const img = images.get(cardKey(row.cards[i]!));
      if (img) {
        ctx.drawImage(img, x, row.y, cardWidth, cardHeight);
      } else {
        // Art still in flight, or a printing with no scan: hold the slot so the
        // rhythm of the row doesn't change when it arrives.
        ctx.fillStyle = 'rgba(128, 118, 100, 0.22)';
        ctx.fillRect(x, row.y, cardWidth, cardHeight);
      }
    }
  }
}

function drawStage(
  ctx: CanvasRenderingContext2D,
  scene: WallScene,
  images: WallImages,
  t: number,
  width: number,
  pad: number
): void {
  for (const row of scene.rows) {
    drawRow(ctx, scene, row, images, t, -pad, width + pad);
  }
}

export interface WallPainter {
  paint(
    ctx: CanvasRenderingContext2D,
    scene: WallScene,
    images: WallImages,
    t: number,
    width: number,
    height: number,
    look: WallLook
  ): void;
}

/**
 * A painter with its own scratch canvas for the blur pass.
 *
 * Blurring in place would fade the stage edges toward transparency, because
 * `filter` samples outside the source bitmap. The scratch is drawn one blur
 * radius larger on every side and blitted back at 1:1, so the fade happens in
 * margin that is then cropped away — no edge halo, no zoom to hide one.
 */
export function createWallPainter(): WallPainter {
  let scratch: HTMLCanvasElement | null = null;

  return {
    paint(ctx, scene, images, t, width, height, look) {
      const blurPx = (look.blur * height) / BLUR_REFERENCE_HEIGHT;
      const fill = BACKGROUND_FILL[look.background];

      if (blurPx > 0.5) {
        const pad = Math.ceil(blurPx * 3);
        if (!scratch) {
          scratch = document.createElement('canvas');
        }
        const sw = Math.ceil(width) + pad * 2;
        const sh = Math.ceil(height) + pad * 2;
        if (scratch.width !== sw || scratch.height !== sh) {
          scratch.width = sw;
          scratch.height = sh;
        }
        const sctx = scratch.getContext('2d');
        if (sctx) {
          sctx.setTransform(1, 0, 0, 1, 0, 0);
          sctx.fillStyle = fill;
          sctx.fillRect(0, 0, sw, sh);
          sctx.translate(pad, pad);
          drawStage(sctx, scene, images, t, width, pad);
          ctx.filter = `blur(${blurPx}px)`;
          ctx.drawImage(scratch, -pad, -pad);
          ctx.filter = 'none';
        }
      } else {
        ctx.fillStyle = fill;
        ctx.fillRect(0, 0, width, height);
        drawStage(ctx, scene, images, t, width, 0);
      }

      if (look.darken > 0) {
        ctx.fillStyle = `rgba(0, 0, 0, ${look.darken})`;
        ctx.fillRect(0, 0, width, height);
      }
    }
  };
}
