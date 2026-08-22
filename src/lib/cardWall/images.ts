/**
 * Card art for the wall, loaded so it can be drawn to an exportable canvas.
 *
 * Same-origin `/thumbnails` only. Anything cross-origin taints the canvas and
 * `getImageData` throws, which would kill the GIF export outright — and the
 * Limitless CDN can't be hotlinked from a browser anyway (see
 * components/cardImage/sources).
 *
 * One tier for everything: `sm` is 274px wide, which covers every card size the
 * wall draws except a two-row 1080p stage, where it upscales about 20% — on
 * art that is moving, and usually blurred, that is a better trade than making
 * the page fetch 48 large scans up front.
 * @module src/lib/cardWall/images
 */

import type { WallCard } from './roster';

const cache = new Map<string, Promise<HTMLImageElement | null>>();

export function wallThumbUrl(card: WallCard): string {
  return `/thumbnails/sm/${card.set.toUpperCase()}/${card.number}`;
}

/** Stable key for a printing, used to look art up while drawing. */
export function cardKey(card: WallCard): string {
  return `${card.set}::${card.number}`;
}

function load(url: string): Promise<HTMLImageElement | null> {
  let pending = cache.get(url);
  if (!pending) {
    pending = new Promise(resolve => {
      const img = new Image();
      // Resolving null rather than rejecting: one missing scan should leave a
      // gap in the wall, not fail the whole load and blank the stage.
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
    cache.set(url, pending);
  }
  return pending;
}

export type WallImages = Map<string, HTMLImageElement>;

/**
 * Load every roster image, reporting progress as they arrive.
 * @param cards - roster to load
 * @param onProgress - called with (loaded, total) after each settles
 * @returns art by {@link cardKey}, missing entries simply absent
 */
export async function loadWallImages(
  cards: readonly WallCard[],
  onProgress?: (loaded: number, total: number) => void
): Promise<WallImages> {
  const images: WallImages = new Map();
  let done = 0;
  await Promise.all(
    cards.map(async card => {
      const img = await load(wallThumbUrl(card));
      if (img) {
        images.set(cardKey(card), img);
      }
      done += 1;
      onProgress?.(done, cards.length);
    })
  );
  return images;
}
