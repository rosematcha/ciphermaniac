/**
 * PNG/JPG export of the social-graphics canvas.
 *
 * Rasterizes the live preview through an SVG <foreignObject> (modern-screenshot),
 * with Inter inlined so the export never depends on a network font.
 * @module src/pages/socialGraphics/exportCanvas
 */
import { interEmbedCss } from '../../utils/fontEmbed';

/** Resolves once every image on the canvas has loaded or failed, so no thumbnail is caught half-decoded. */
function imagesSettled(node: HTMLElement): Promise<unknown> {
  return Promise.all(
    Array.from(node.querySelectorAll('img')).map(img =>
      img.complete && img.naturalWidth > 0
        ? Promise.resolve()
        : new Promise<void>(resolve => {
            img.addEventListener('load', () => resolve(), { once: true });
            img.addEventListener('error', () => resolve(), { once: true });
          })
    )
  );
}

/**
 * Rasterize the rendered canvas (#sg-canvas) and hand it to the browser as a download.
 * @param format - Image format
 * @param fileName - Download name
 */
export async function exportCanvas(format: 'png' | 'jpg', fileName: string): Promise<void> {
  const node = document.getElementById('sg-canvas');
  if (!node) {
    throw new Error('Canvas not ready.');
  }
  await imagesSettled(node);
  const [{ domToPng, domToJpeg }, fontCssText] = await Promise.all([import('modern-screenshot'), interEmbedCss()]);
  const renderer = format === 'png' ? domToPng : domToJpeg;
  const dataUrl = await renderer(node, {
    scale: 1,
    // The canvas paints its own theme, so read it instead of repeating the palette here.
    backgroundColor: getComputedStyle(node).backgroundColor,
    quality: format === 'jpg' ? 0.92 : undefined,
    font: { cssText: fontCssText }
  });
  const a = document.createElement('a');
  a.download = fileName;
  a.href = dataUrl;
  a.click();
}
