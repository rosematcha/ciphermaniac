/**
 * The print queue: labels you've finished designing, parked until you print a
 * batch. Framework-free so it can be unit-tested — the page owns the signals,
 * this module owns the shape, the storage round-trip, and the print document.
 */
import { defaultConfig, type LabelConfig } from './types';
import { dimsForLabel, type LabelDims, mmToDots, PRINTERS } from './printers';

export const QUEUE_STORAGE_KEY = 'cm:labelmaker:queue:v1';

/** A custom (non-preset) label geometry, in millimetres plus a dpi. */
export interface CustomSize {
  wMm: number;
  hMm: number;
  dpi: number;
}

/**
 * How a queued label was sized. Kept as the printer/label ids rather than the
 * resolved dots so a preset that gets corrected later (the 62mm tape prints 696
 * dots, not 732) fixes labels that were queued before the correction.
 */
export interface LabelSizeSpec {
  printerId: string;
  labelId: string;
  custom: CustomSize | null;
}

export interface QueuedLabel {
  id: string;
  config: LabelConfig;
  size: LabelSizeSpec;
}

/** Resolve a size spec to printable geometry, clamping nonsense custom input. */
export function resolveDims(size: LabelSizeSpec): LabelDims {
  if (size.custom) {
    const dpi = Math.max(72, size.custom.dpi || 300);
    const wMm = Math.max(10, size.custom.wMm || 62);
    const hMm = Math.max(10, size.custom.hMm || 29);
    return { dpi, wMm, hMm, wDots: mmToDots(wMm, dpi), hDots: mmToDots(hMm, dpi) };
  }
  const printer = PRINTERS.find(p => p.id === size.printerId) ?? PRINTERS[0];
  const label = printer.labels.find(l => l.id === size.labelId) ?? printer.labels[0];
  return dimsForLabel(printer.dpi, label);
}

/** Human-readable size, for the queue rows. */
export function describeSize(dims: LabelDims): string {
  return `${dims.wMm} × ${dims.hMm} mm`;
}

/** The label the queue row shows. Falls back so a row is never blank. */
export function queueLabelName(item: QueuedLabel): string {
  return item.config.title.trim() || item.config.subtitle.trim() || 'Untitled label';
}

// ---------- persistence ----------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function pickString(raw: Record<string, unknown>, key: keyof LabelConfig, fallback: string): string {
  const v = raw[key];
  return typeof v === 'string' ? v : fallback;
}

function pickNumber(raw: Record<string, unknown>, key: keyof LabelConfig, fallback: number): number {
  const v = raw[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function pickEnum<T extends string>(
  raw: Record<string, unknown>,
  key: keyof LabelConfig,
  allowed: readonly T[],
  fallback: T
): T {
  const v = raw[key];
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

/**
 * Rebuild a config from stored JSON. Anything missing or off-type falls back to
 * the default for that field, so a queue written by an older version of the
 * page still loads instead of taking the whole queue down with it.
 */
export function sanitizeConfig(raw: unknown): LabelConfig {
  if (!isRecord(raw)) {
    return { ...defaultConfig };
  }
  const { pokemon1, pokemon2 } = raw;
  return {
    layout: pickEnum(raw, 'layout', ['keepsake', 'ticket'], defaultConfig.layout),
    pokemon1: typeof pokemon1 === 'string' ? pokemon1 : null,
    pokemon2: typeof pokemon2 === 'string' ? pokemon2 : null,
    duoSizing: pickEnum(raw, 'duoSizing', ['primary-larger', 'equal'], defaultConfig.duoSizing),
    titleBreak: typeof raw.titleBreak === 'boolean' ? raw.titleBreak : defaultConfig.titleBreak,
    spriteSide: pickEnum(raw, 'spriteSide', ['left', 'right'], defaultConfig.spriteSide),
    title: pickString(raw, 'title', defaultConfig.title),
    subtitle: pickString(raw, 'subtitle', defaultConfig.subtitle),
    subtitleStyle: pickEnum(raw, 'subtitleStyle', ['italic', 'regular', 'caps'], defaultConfig.subtitleStyle),
    // A label queued while 'progress' was still a third-row choice falls back
    // to the default rather than carrying a value the editor can no longer show.
    thirdRow: pickEnum(raw, 'thirdRow', ['none', 'text', 'stars'], defaultConfig.thirdRow),
    stars: pickNumber(raw, 'stars', defaultConfig.stars),
    starsMax: pickNumber(raw, 'starsMax', defaultConfig.starsMax),
    progressCurrent: pickNumber(raw, 'progressCurrent', defaultConfig.progressCurrent),
    progressTotal: pickNumber(raw, 'progressTotal', defaultConfig.progressTotal),
    extraText: pickString(raw, 'extraText', defaultConfig.extraText),
    stubContent: pickEnum(raw, 'stubContent', ['stars', 'progress', 'count'], defaultConfig.stubContent),
    stubLabel: pickString(raw, 'stubLabel', defaultConfig.stubLabel),
    formatText: pickString(raw, 'formatText', defaultConfig.formatText)
  };
}

function sanitizeSize(raw: unknown): LabelSizeSpec {
  const fallback: LabelSizeSpec = { printerId: PRINTERS[0].id, labelId: PRINTERS[0].labels[0].id, custom: null };
  if (!isRecord(raw)) {
    return fallback;
  }
  const { custom } = raw;
  if (isRecord(custom)) {
    const { wMm, hMm, dpi } = custom;
    const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
    if (finite(wMm) && finite(hMm) && finite(dpi)) {
      return { printerId: fallback.printerId, labelId: fallback.labelId, custom: { wMm, hMm, dpi } };
    }
  }
  return {
    printerId: typeof raw.printerId === 'string' ? raw.printerId : fallback.printerId,
    labelId: typeof raw.labelId === 'string' ? raw.labelId : fallback.labelId,
    custom: null
  };
}

/** Parse stored JSON into a queue. A corrupt payload yields an empty queue. */
export function parseQueue(rawJson: string): QueuedLabel[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter(isRecord).map((item, i) => ({
    id: typeof item.id === 'string' && item.id ? item.id : `label-${i}`,
    config: sanitizeConfig(item.config),
    size: sanitizeSize(item.size)
  }));
}

export function loadQueue(storage: Storage): QueuedLabel[] {
  try {
    const raw = storage.getItem(QUEUE_STORAGE_KEY);
    return raw === null ? [] : parseQueue(raw);
  } catch {
    return [];
  }
}

export function saveQueue(storage: Storage, items: QueuedLabel[]): void {
  try {
    storage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(items));
  } catch {
    /* storage unavailable or full — the in-memory queue still prints */
  }
}

// ---------- print document ----------

export interface PrintJob {
  dataUrl: string;
  dims: LabelDims;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function sizeKey(dims: LabelDims): string {
  return `${dims.wMm}x${dims.hMm}`;
}

/**
 * One document, one print job, one page per label. Each image is placed at its
 * exact physical size with no page margin so the driver has nothing to scale —
 * that's what keeps 1 label dot on 1 printer dot.
 *
 * A batch may mix sizes, so pages are named (`@page tag { size }` +
 * `page: tag`) and each label is assigned the page matching its own geometry.
 */
export function buildPrintDocument(jobs: PrintJob[], title: string): string {
  const sizes = new Map<string, LabelDims>();
  for (const job of jobs) {
    sizes.set(sizeKey(job.dims), job.dims);
  }
  const pageNames = new Map<string, string>();
  let i = 0;
  for (const key of sizes.keys()) {
    pageNames.set(key, `lbl${i}`);
    i += 1;
  }

  const pageRules = [...sizes.entries()]
    .map(([key, d]) => `@page ${pageNames.get(key)!} { size: ${d.wMm}mm ${d.hMm}mm; margin: 0; }`)
    .join('');
  const sheetRules = [...sizes.entries()]
    .map(
      ([key, d]) =>
        `.${pageNames.get(key)!} { page: ${pageNames.get(key)!}; }` +
        `.${pageNames.get(key)!} img { width: ${d.wMm}mm; height: ${d.hMm}mm; }`
    )
    .join('');

  const body = jobs
    .map(job => {
      const cls = pageNames.get(sizeKey(job.dims))!;
      return `<div class="sheet ${cls}"><img src="${job.dataUrl}" alt=""></div>`;
    })
    .join('');

  // break-after on every sheet but the last, so a single label still prints one
  // page rather than one page plus a blank.
  const baseRules =
    'html, body { margin: 0; padding: 0; }' +
    'img { display: block; image-rendering: pixelated; }' +
    '.sheet { break-after: page; page-break-after: always; }' +
    '.sheet:last-child { break-after: auto; page-break-after: auto; }';

  return `<!doctype html><html><head><title>${escapeHtml(title)}</title><style>${pageRules}${baseRules}${sheetRules}</style></head><body onload="window.print()">${body}</body></html>`;
}
