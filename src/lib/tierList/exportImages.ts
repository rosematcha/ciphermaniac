/**
 * Card art at the size the export draws it.
 *
 * The rasteriser inlines every image as a data URL inside one SVG, at the
 * file's own size. A vintage card is a 245px PNG of about 180 KB drawn 46px
 * wide, so a full Formats board put 2.5 MB of images (7 MB once inlined) into
 * the SVG a phone has to decode. Redrawing each card at its export size first
 * keeps the SVG to what the image needs.
 * @module lib/tierList/exportImages
 */

/** Card images only: sprites are small already, and a redraw would blur them. */
const CARD_ART = '.card-stack-slot img, .tl-art img';

/**
 * Redraws a board's card art at its export size and returns the rasteriser's
 * `onEmbedNode`, which puts the small copies in the clone. Call with the board
 * laid out as it will be exported.
 * @param board - The node being exported.
 * @param scale - The export's pixel scale.
 */
export function shrinkCardArt(board: HTMLElement, scale: number): (cloned: Node) => void {
  const shrunk = new Map<string, string>();
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  for (const img of board.querySelectorAll<HTMLImageElement>(CARD_ART)) {
    const width = Math.ceil(img.getBoundingClientRect().width * scale);
    // Within a quarter of the file's size is not worth a redraw.
    if (!context || width === 0 || img.naturalWidth <= width * 1.25) {
      continue;
    }
    canvas.width = width;
    canvas.height = Math.round((img.naturalHeight / img.naturalWidth) * width);
    context.drawImage(img, 0, 0, canvas.width, canvas.height);
    try {
      // WebP keeps the corners transparent; a browser without it falls back to PNG.
      const url = canvas.toDataURL('image/webp', 0.9);
      shrunk.set(img.currentSrc, url).set(img.src, url);
    } catch {
      // A cross-origin image taints the canvas; it is inlined at full size.
    }
  }
  // After embedding, not on clone: a detached clone keeps its old currentSrc
  // when its src changes, so the embedder would fetch the full file anyway.
  // It leaves the URL it fetched in `data-original-src`.
  return clone => {
    if (!(clone instanceof Element)) {
      return;
    }
    for (const img of clone.querySelectorAll('img')) {
      const small = shrunk.get(img.dataset.originalSrc ?? '');
      if (small) {
        img.src = small;
      }
    }
  };
}
