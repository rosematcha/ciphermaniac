/**
 * Canvas renderer for deck box labels. Framework-free on purpose — the page
 * just hands it a canvas, a config, and the target label geometry.
 *
 * Everything here is written for 1-bit thermal output: pure #000/#fff, hard
 * sprite edges, Bayer-dithered midtones. That's a deliberate exception to the
 * site palette — it's physical ink, not UI.
 */
import { type LabelConfig } from './types';
import { type LabelDims } from './printers';

// Layouts were designed on a 696x271 grid (62x29mm at 300dpi). Metrics scale by
// whichever axis is tighter, so labels with a different aspect ratio (a tall
// 100x62 continuous label, a stubby 54x17) stay in proportion instead of
// overflowing the narrow axis.
const DESIGN_W = 696;
const DESIGN_H = 271;

const spriteCache = new Map<string, Promise<HTMLImageElement>>();

/**
 * Same-origin sprite URL. Must stay same-origin: a cross-origin <img> taints
 * the canvas and toDataURL() throws, killing both Print and Download PNG.
 * Served by functions/sprites/[[path]].ts.
 */
export function spriteUrl(name: string): string {
  return `/sprites/${name}.png`;
}

function loadSprite(name: string): Promise<HTMLImageElement> {
  let cached = spriteCache.get(name);
  if (!cached) {
    cached = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`sprite not found: ${name}`));
      img.src = spriteUrl(name);
    });
    spriteCache.set(name, cached);
  }
  return cached;
}

// 4x4 Bayer matrix, used to dither sprite midtones to 1-bit for thermal printing.
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5]
];

interface Raster {
  canvas: HTMLCanvasElement;
  w: number;
  h: number;
  /** per-row ink extents, indexed from the bottom row up */
  leftProfile: Int32Array;
  rightProfile: Int32Array;
}

const EMPTY_ROW = -1;

/**
 * Content-aware horizontal nesting: slide `back` toward `front` until their
 * actual silhouettes are `gap` apart at their closest point (negative gap =
 * deliberate overlap). Returns the back sprite's x offset from the front's.
 */
function nestOffset(front: Raster, back: Raster, gap: number): number {
  const rows = Math.min(front.h, back.h);
  let closest = -Infinity;
  for (let i = 0; i < rows; i++) {
    const fr = front.rightProfile[i]!;
    const bl = back.leftProfile[i]!;
    if (fr === EMPTY_ROW || bl === EMPTY_ROW) {
      continue;
    }
    // Offset at which this row's silhouettes would just touch.
    const touch = fr - bl;
    if (touch > closest) {
      closest = touch;
    }
  }
  // No shared rows (e.g. one sprite is much shorter): fall back to side-by-side.
  if (closest === -Infinity) {
    return front.w + gap;
  }
  return closest + gap;
}

const BLACK_CUT = 64;
const WHITE_CUT = 214;

/** Luminance at which `frac` of the sprite's opaque pixels are darker. */
function percentile(hist: Uint32Array, total: number, frac: number): number {
  const target = total * frac;
  let seen = 0;
  for (let g = 0; g < 256; g++) {
    seen += hist[g]!;
    if (seen >= target) {
      return g;
    }
  }
  return 255;
}

/**
 * Per-sprite tone curve: a 256-entry lookup from source luminance to print
 * luminance. Two stages, both driven by the sprite's own histogram.
 *
 * First an auto-level onto [p2, p98] with the shadow end crushed to black, so
 * a sprite that only occupies a narrow slice of the range still uses the full
 * one and keeps its outline. Then a gamma chosen so the sprite's median tone
 * lands on TARGET_MEDIAN — that's what keeps overall ink
 * coverage roughly constant across sprites, instead of letting dark Pokemon
 * clip to a solid blob and pale ones dissolve.
 */
export function buildToneCurve(hist: Uint32Array, total: number): Uint8Array {
  const TARGET_MEDIAN = 0.56;
  const lut = new Uint8Array(256);
  if (total === 0) {
    for (let g = 0; g < 256; g++) {
      lut[g] = g;
    }
    return lut;
  }
  let lo = percentile(hist, total, 0.02);
  let hi = percentile(hist, total, 0.98);
  // A near-flat sprite has no contrast worth stretching; expanding it would
  // amplify compression noise into dither speckle.
  if (hi - lo < 40) {
    lo = 0;
    hi = 255;
  }
  const span = hi - lo;
  // The darkest slice of the range is the sprite's outline. Reserve it for
  // solid black before the gamma runs, otherwise lightening a dark Pokemon
  // lifts its outline into the dither band and the silhouette falls apart.
  const SHADOW = 0.18;
  const norm = (g: number) => {
    const n = Math.min(1, Math.max(0, (g - lo) / span));
    return n <= SHADOW ? 0 : (n - SHADOW) / (1 - SHADOW);
  };
  const median = norm(percentile(hist, total, 0.5));
  // gamma < 1 lightens (dark sprites), > 1 darkens (pale ones). Clamped so a
  // sprite that is genuinely almost all black or all white keeps looking that
  // way rather than being forced to mid-gray.
  const gamma =
    median <= 0.02 || median >= 0.98 ? 1 : Math.min(1.7, Math.max(0.35, Math.log(TARGET_MEDIAN) / Math.log(median)));
  for (let g = 0; g < 256; g++) {
    lut[g] = Math.round(255 * norm(g) ** gamma);
  }
  return lut;
}

/** Rasterize a sprite: scale, dither to 1-bit, and trim transparent padding. */
function rasterize(img: HTMLImageElement, scale: number): Raster | null {
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  // Upscale smoothly to the final print size BEFORE dithering, so each dither
  // dot is one printer dot instead of a scale-x-scale block.
  const off = document.createElement('canvas');
  off.width = w;
  off.height = h;
  const octx = off.getContext('2d', { willReadFrequently: true });
  if (!octx) {
    return null;
  }
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(img, 0, 0, w, h);
  const data = octx.getImageData(0, 0, w, h);
  const px = data.data;

  // Tone mapping is per sprite, not a fixed curve. A single global gamma has to
  // be tuned for one kind of sprite and wrecks the other: pale Pokemon
  // (Alakazam) wash out, and dark ones (Dragapult) fall entirely under the
  // black cutoff and print as a silhouette. Instead, read each sprite's own
  // luminance distribution and stretch it onto the printable range.
  const lum = new Uint8Array(w * h);
  const hist = new Uint32Array(256);
  let opaque = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3]! < 128) {
      continue;
    }
    const g = Math.round(0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]!);
    lum[i / 4] = g;
    hist[g]! += 1;
    opaque += 1;
  }
  const TONE = buildToneCurve(hist, opaque);

  for (let i = 0; i < px.length; i += 4) {
    const p = i / 4;
    const sx = p % w;
    const sy = Math.floor(p / w);
    if (px[i + 3]! < 128) {
      px[i + 3] = 0;
      continue;
    }
    const gray = TONE[lum[p]!]!;
    // Hybrid: outlines/dark pixels go solid black, near-white goes clean white,
    // and only the midtones are Bayer-dithered for shading.
    let v: number;
    if (gray < BLACK_CUT) {
      v = 0;
    } else if (gray > WHITE_CUT) {
      v = 255;
    } else {
      const threshold = BLACK_CUT + ((BAYER[sy % 4]![sx % 4]! + 0.5) / 16) * (WHITE_CUT - BLACK_CUT);
      v = gray > threshold ? 255 : 0;
    }
    px[i] = px[i + 1] = px[i + 2] = v;
    px[i + 3] = v === 255 ? 0 : 255; // white becomes transparent so bg shows through
  }
  octx.putImageData(data, 0, 0);

  // Trim transparent padding so layout math uses real ink extents, not the
  // sprite sheet's empty margins.
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3]! > 0) {
        if (x < minX) {
          minX = x;
        }
        if (x > maxX) {
          maxX = x;
        }
        if (y < minY) {
          minY = y;
        }
        if (y > maxY) {
          maxY = y;
        }
      }
    }
  }
  if (maxX < 0) {
    return null;
  }
  const tw = maxX - minX + 1;
  const th = maxY - minY + 1;
  const trimmed = document.createElement('canvas');
  trimmed.width = tw;
  trimmed.height = th;
  const tctx = trimmed.getContext('2d');
  if (!tctx) {
    return null;
  }
  tctx.imageSmoothingEnabled = false;
  tctx.drawImage(off, minX, minY, tw, th, 0, 0, tw, th);

  // Per-row ink extents (bottom row first) drive content-aware nesting.
  const leftProfile = new Int32Array(th);
  const rightProfile = new Int32Array(th);
  for (let i = 0; i < th; i++) {
    const y = minY + (th - 1 - i);
    let l = EMPTY_ROW;
    let r = EMPTY_ROW;
    for (let x = minX; x <= maxX; x++) {
      if (px[(y * w + x) * 4 + 3]! > 0) {
        if (l === EMPTY_ROW) {
          l = x - minX;
        }
        r = x - minX;
      }
    }
    leftProfile[i] = l;
    rightProfile[i] = r;
  }
  return { canvas: trimmed, w: tw, h: th, leftProfile, rightProfile };
}

/** Draw a white halo around a sprite so it reads clearly over the one behind it. */
function drawHalo(ctx: CanvasRenderingContext2D, r: Raster, x: number, y: number, radius: number) {
  const pad = Math.ceil(radius);
  const halo = document.createElement('canvas');
  halo.width = r.w + pad * 2;
  halo.height = r.h + pad * 2;
  const hctx = halo.getContext('2d');
  if (!hctx) {
    return;
  }
  hctx.imageSmoothingEnabled = false;
  for (let a = 0; a < 16; a++) {
    const ang = (a / 16) * Math.PI * 2;
    hctx.drawImage(r.canvas, pad + Math.cos(ang) * radius, pad + Math.sin(ang) * radius);
  }
  hctx.globalCompositeOperation = 'source-in';
  hctx.fillStyle = '#fff';
  hctx.fillRect(0, 0, halo.width, halo.height);
  ctx.drawImage(halo, Math.round(x - pad), Math.round(y - pad));
}

function drawRaster(ctx: CanvasRenderingContext2D, r: Raster, x: number, y: number) {
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(r.canvas, Math.round(x), Math.round(y));
}

function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, filled: boolean, u: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.44;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = cx + rad * Math.cos(a);
    const y = cy + rad * Math.sin(a);
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.closePath();
  if (filled) {
    ctx.fillStyle = '#000';
    ctx.fill();
  } else {
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2.5 * u;
    ctx.stroke();
  }
}

function drawStars(
  ctx: CanvasRenderingContext2D,
  x: number,
  cy: number,
  value: number,
  max: number,
  size: number,
  u: number
): number {
  const gap = size * 0.4;
  for (let i = 0; i < max; i++) {
    drawStar(ctx, x + size / 2 + i * (size + gap), cy, size / 2, i < value, u);
  }
  return max * size + (max - 1) * gap;
}

function drawProgress(
  ctx: CanvasRenderingContext2D,
  x: number,
  cy: number,
  w: number,
  h: number,
  current: number,
  total: number,
  u: number
) {
  const lw = 3 * u;
  ctx.strokeStyle = '#000';
  ctx.lineWidth = lw;
  ctx.strokeRect(x + lw / 2, cy - h / 2 + lw / 2, w - lw, h - lw);
  const frac = total > 0 ? Math.min(1, Math.max(0, current / total)) : 0;
  ctx.fillStyle = '#000';
  ctx.fillRect(x + lw / 2, cy - h / 2 + lw / 2, (w - lw) * frac, h - lw);
}

function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  baseSize: number,
  maxWidth: number,
  weight: number,
  u: number,
  italic = false
): number {
  let size = baseSize;
  for (; size > 18 * u; size -= 2) {
    ctx.font = `${italic ? 'italic ' : ''}${weight} ${size}px Archivo`;
    if (ctx.measureText(text).width <= maxWidth) {
      break;
    }
  }
  return size;
}

interface TextBlockOpts {
  x: number;
  maxWidth: number;
  config: LabelConfig;
  titleSize: number;
  labelH: number;
  u: number;
}

/**
 * Manual line breaks. The title comes from a single-line <input>, so there's no
 * real newline to type — `/n` is the escape, and `\n` is accepted too since
 * people reach for it out of habit.
 */
function manualLines(text: string): string[] {
  return text
    .split(/\/n|\\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0);
}

export function titleLinesFor(config: LabelConfig): string[] {
  const manual = manualLines(config.title);
  if (manual.length > 1) {
    return manual;
  }
  const title = manual[0] ?? '';
  if (config.titleBreak && title.includes(' ') && config.pokemon2) {
    return [title.slice(0, title.indexOf(' ')), title.slice(title.indexOf(' ') + 1)];
  }
  return [title];
}

function drawTextBlock(ctx: CanvasRenderingContext2D, opts: TextBlockOpts) {
  const { x, maxWidth, config, labelH, u } = opts;
  const titleLines = titleLinesFor(config);

  let { titleSize } = opts;
  // Three or more manual lines would otherwise run off the label, so cap the
  // title by the height it has to live in as well as by each line's width.
  if (titleLines.length > 2) {
    titleSize = Math.min(titleSize, (labelH * 0.72) / (titleLines.length * 1.06));
  }
  for (const line of titleLines) {
    titleSize = Math.min(titleSize, fitText(ctx, line, titleSize, maxWidth, 800, u));
  }
  const subtitleText = config.subtitle.trim();
  const showSubtitle = subtitleText.length > 0;
  const bySize = 23 * u;
  const rowH = 34 * u;
  const titleH = titleLines[0] ? titleLines.length * titleSize * 1.06 : 0;
  const showThird = config.layout === 'keepsake' && config.thirdRow !== 'none';
  const totalH = titleH + (showSubtitle ? 12 * u + bySize : 0) + (showThird ? 16 * u + rowH : 0);
  let y = (labelH - totalH) / 2;

  ctx.fillStyle = '#000';
  ctx.textBaseline = 'top';
  if (titleLines[0]) {
    ctx.font = `800 ${titleSize}px Archivo`;
    for (const line of titleLines) {
      ctx.fillText(line, x, y);
      y += titleSize * 1.06;
    }
  }
  if (showSubtitle) {
    y += 12 * u;
    const caps = config.subtitleStyle === 'caps';
    const italic = config.subtitleStyle === 'italic';
    const weight = caps ? 700 : 500;
    const text = caps ? subtitleText.toUpperCase() : subtitleText;
    const byFit = fitText(ctx, text, bySize, maxWidth, weight, u, italic);
    ctx.font = `${italic ? 'italic ' : ''}${weight} ${byFit}px Archivo`;
    if (caps) {
      ctx.letterSpacing = `${1.5 * u}px`;
    }
    ctx.fillText(text, x, y);
    ctx.letterSpacing = '0px';
    y += bySize;
  }
  if (showThird) {
    y += 16 * u;
  }

  if (showThird) {
    const cy = y + rowH / 2 - 4 * u;
    if (config.thirdRow === 'stars') {
      drawStars(ctx, x, cy, config.stars, config.starsMax, 26 * u, u);
    } else if (config.thirdRow === 'text' && config.extraText) {
      const size = fitText(ctx, config.extraText, 24 * u, maxWidth, 600, u);
      ctx.font = `600 ${size}px Archivo`;
      ctx.fillText(config.extraText, x, y);
    }
  }
}

export async function renderLabel(canvas: HTMLCanvasElement, config: LabelConfig, dims: LabelDims): Promise<void> {
  const W = dims.wDots;
  const H = dims.hDots;
  const u = Math.min(H / DESIGN_H, W / DESIGN_W);
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }

  // Every weight this renderer can draw with. Canvas has no font-loading
  // fallback — an unloaded face silently rasterizes as the browser default, so
  // a missing entry here shows up as one row of the label in the wrong
  // typeface. Cheap to over-request: these resolve instantly once cached.
  await Promise.all([
    document.fonts.load('500 23px Archivo'),
    document.fonts.load('600 24px Archivo'),
    document.fonts.load('700 15px Archivo'),
    document.fonts.load('800 54px Archivo'),
    document.fonts.load('italic 500 23px Archivo'),
    document.fonts.load('600 19px "IBM Plex Mono"')
  ]);

  const img1 = config.pokemon1 ? await loadSprite(config.pokemon1).catch(() => null) : null;
  const img2 = config.pokemon2 ? await loadSprite(config.pokemon2).catch(() => null) : null;

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);

  const stubW = 156 * u;
  const pad = 38 * u;
  const rightEdge = config.layout === 'ticket' ? W - stubW : W;
  const spriteBottom = H / 2;

  // Sprite scales stay integer multiples of the source pixels for crisp edges.
  const s1 = Math.max(1, Math.round((config.pokemon2 ? (config.duoSizing === 'primary-larger' ? 4 : 3) : 4) * u));
  const s2 = Math.max(1, Math.round(3 * u));
  const r1 = img1 ? rasterize(img1, s1) : null;
  const r2 = img2 ? rasterize(img2, s2) : null;

  // Nest the pair by their real silhouettes rather than a fixed fraction, so a
  // tall narrow sprite and a long low one each sit correctly against the other.
  const nestGap = -4 * u;
  const offset2 = r1 && r2 ? nestOffset(r1, r2, nestGap) : 0;
  const groupW = r1 && r2 ? Math.max(r1.w, offset2 + r2.w) : (r1?.w ?? 0);

  // Fixed-width sprite column: the group centers inside it so the text block
  // always starts at the same x, whether there are two sprites, one, or none.
  const iconBox = 230 * u;
  const boxX = config.spriteSide === 'left' ? pad : rightEdge - pad - iconBox;
  const groupX = boxX + (iconBox - groupW) / 2;
  // Bottom-align on real ink, centered as a group in the label height.
  const groupH = Math.max(r1?.h ?? 0, r2?.h ?? 0);
  const groupBottom = spriteBottom + groupH / 2;

  if (r1 && r2) {
    const x2 = groupX + offset2;
    drawRaster(ctx, r2, x2, groupBottom - r2.h);
    // Knock the partner back with a white outline, then draw the primary on top.
    drawHalo(ctx, r1, groupX, groupBottom - r1.h, Math.max(2, 3 * u));
    drawRaster(ctx, r1, groupX, groupBottom - r1.h);
  } else if (r1) {
    drawRaster(ctx, r1, groupX, groupBottom - r1.h);
  }

  const gap = 24 * u;
  const textX = config.spriteSide === 'left' ? boxX + iconBox + gap : pad;
  const textMax = config.spriteSide === 'left' ? rightEdge - pad - textX : boxX - gap - pad;

  drawTextBlock(ctx, {
    x: textX,
    maxWidth: textMax,
    config,
    titleSize: (config.pokemon2 ? 44 : 54) * u,
    labelH: H,
    u
  });

  if (config.layout === 'ticket') {
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2 * u;
    ctx.setLineDash([10 * u, 8 * u]);
    ctx.beginPath();
    ctx.moveTo(W - stubW, 0);
    ctx.lineTo(W - stubW, H);
    ctx.stroke();
    ctx.setLineDash([]);

    const cx = W - stubW / 2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#000';
    if (config.stubContent === 'stars') {
      // Format is optional; with it omitted the stars sit centred in the stub
      // instead of leaving a hole where the format block would have been.
      const format = config.formatText.trim();
      const labelY = (format ? 78 : 100) * u;
      const starsY = (format ? 118 : 140) * u;
      ctx.font = `700 ${15 * u}px Archivo`;
      ctx.fillText(config.stubLabel.toUpperCase(), cx, labelY);
      const starSize = 21 * u;
      const starsW = config.starsMax * starSize + (config.starsMax - 1) * starSize * 0.4;
      drawStars(ctx, cx - starsW / 2, starsY, config.stars, config.starsMax, starSize, u);
      if (format) {
        ctx.font = `700 ${15 * u}px Archivo`;
        ctx.fillText('FORMAT', cx, 152 * u);
        ctx.font = `600 ${25 * u}px "IBM Plex Mono"`;
        ctx.fillText(format, cx, 174 * u);
      }
    } else if (config.stubContent === 'progress') {
      ctx.font = `700 ${15 * u}px Archivo`;
      ctx.fillText('BUILT', cx, 84 * u);
      drawProgress(ctx, cx - 50 * u, 122 * u, 100 * u, 18 * u, config.progressCurrent, config.progressTotal, u);
      ctx.font = `600 ${25 * u}px "IBM Plex Mono"`;
      ctx.fillText(`${config.progressCurrent}/${config.progressTotal}`, cx, 146 * u);
    } else {
      ctx.font = `600 ${56 * u}px "IBM Plex Mono"`;
      ctx.fillText(String(config.progressCurrent), cx, 84 * u);
      ctx.font = `700 ${15 * u}px Archivo`;
      ctx.fillText(`OF ${config.progressTotal}`, cx, 152 * u);
    }
    ctx.textAlign = 'left';
  }
}
