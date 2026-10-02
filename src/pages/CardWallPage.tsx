import { createEffect, createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { cardKey, loadWallImages, type WallImages } from '../lib/cardWall/images';
import {
  buildScene,
  GIF_FRAME_RATES,
  type RowSetting,
  type WallConfig,
  type WallDeal,
  type WallScene
} from '../lib/cardWall/scene';
import { createWallPainter, type WallLook, type WallPainter } from '../lib/cardWall/render';
import { describeVideoOutput, estimateGifBytes, exportGif, exportVideo, gifFrameCount } from '../lib/cardWall/export';
import { WALL_ROSTER } from '../lib/cardWall/roster';
import { downloadBlob } from '../lib/download';
import { createPersistentSignal } from '../lib/persistentSignal';
import { Segmented } from '../components/Segmented';
import '../styles/pages/card-wall.css';

type AspectKey = '16:9' | '1:1' | '9:16';
type Format = 'gif' | 'video';

const ASPECT: Record<AspectKey, number> = { '16:9': 16 / 9, '1:1': 1, '9:16': 9 / 16 };
const ASPECT_OPTIONS: { value: AspectKey; label: string }[] = [
  { value: '16:9', label: '16:9' },
  { value: '1:1', label: '1:1' },
  { value: '9:16', label: '9:16' }
];
const BACKGROUND_OPTIONS: { value: WallLook['background']; label: string }[] = [
  { value: 'cream', label: 'Cream' },
  { value: 'ink', label: 'Ink' },
  { value: 'black', label: 'Black' }
];
const FORMAT_OPTIONS: { value: Format; label: string }[] = [
  { value: 'gif', label: 'GIF' },
  { value: 'video', label: 'Video' }
];
const WIDTH_OPTIONS = [640, 960, 1280, 1920];
// GIF holds each frame for a whole number of centiseconds, so only rates that
// divide 100 play evenly — anything else alternates frame lengths and judders.
const GIF_FPS_OPTIONS = GIF_FRAME_RATES;
const VIDEO_FPS_OPTIONS = [24, 30, 60];
const COLOR_OPTIONS = [64, 128, 256];
const MAX_ROWS = 6;

/** Preview sharpness. Past 2x the wall costs more than it looks like. */
const MAX_PIXEL_RATIO = 2;

interface Preset {
  label: string;
  config: Partial<WallConfig>;
  look: Partial<WallLook>;
  directions?: ('left' | 'right')[];
}

/**
 * Starting points, not modes — every one of them is just a position of the
 * controls below, and moving any control leaves the preset behind.
 */
const PRESETS: Preset[] = [
  {
    label: 'Drift',
    config: { rows: 4, cardsPerRow: 6, loopSeconds: 12, gap: 0.1, cardScale: 0.82 },
    look: { blur: 0, darken: 0 }
  },
  {
    label: 'Backdrop',
    config: { rows: 4, cardsPerRow: 6, loopSeconds: 14, gap: 0.08, cardScale: 0.86 },
    look: { blur: 14, darken: 0.35 }
  },
  {
    label: 'Ticker',
    config: { rows: 6, cardsPerRow: 8, loopSeconds: 8, gap: 0.14, cardScale: 0.78 },
    look: { blur: 0, darken: 0 }
  },
  {
    label: 'Wall',
    config: { rows: 5, cardsPerRow: 7, loopSeconds: 10, gap: 0.02, cardScale: 1 },
    look: { blur: 0, darken: 0.08 }
  },
  {
    label: 'Parade',
    config: { rows: 2, cardsPerRow: 5, loopSeconds: 8, gap: 0.16, cardScale: 0.88 },
    look: { blur: 0, darken: 0 }
  },
  {
    label: 'Haze',
    config: { rows: 5, cardsPerRow: 6, loopSeconds: 16, gap: 0.06, cardScale: 0.92 },
    look: { blur: 26, darken: 0.5 }
  },
  {
    label: 'Crosscut',
    config: { rows: 4, cardsPerRow: 6, loopSeconds: 12, gap: 0.1, cardScale: 0.84 },
    look: { blur: 4, darken: 0.12 },
    directions: ['left', 'right', 'right', 'left', 'left', 'right']
  },
  {
    label: 'Stampede',
    config: { rows: 6, cardsPerRow: 10, loopSeconds: 6, gap: 0.05, cardScale: 0.9 },
    look: { blur: 6, darken: 0.2 }
  }
];

/** Card keys round-trip through storage as one comma-separated string. */
function parseKeys(raw: string): Set<string> {
  return new Set(raw.split(',').filter(Boolean));
}

function toggleKey(raw: string, key: string): string {
  const keys = parseKeys(raw);
  if (keys.has(key)) {
    keys.delete(key);
  } else {
    keys.add(key);
  }
  return [...keys].join(',');
}

function defaultRowSettings(): RowSetting[] {
  return Array.from({ length: MAX_ROWS }, (_, i) => ({
    direction: i % 2 === 0 ? ('left' as const) : ('right' as const),
    laps: 1
  }));
}

function formatSeconds(value: number): string {
  return value >= 10 ? `${Math.round(value)}s` : `${value.toFixed(1)}s`;
}

/** The loop slider steps in halves, so rounding its own readout would lie about it. */
function formatLoop(value: number): string {
  return Number.isInteger(value) ? `${value}s` : `${value.toFixed(1)}s`;
}

function useCardWall() {
  const [aspect, setAspect] = createSignal<AspectKey>('16:9');
  const [rows, setRows] = createSignal(4);
  const [cardsPerRow, setCardsPerRow] = createSignal(8);
  const [loopSeconds, setLoopSeconds] = createSignal(10);
  const [gap, setGap] = createSignal(0.1);
  const [cardScale, setCardScale] = createSignal(0.84);
  const [seed, setSeed] = createSignal(7);
  const [rowSettings, setRowSettings] = createSignal<RowSetting[]>(defaultRowSettings());
  // Kept across visits: curating 48 cards is work, and losing it to a refresh
  // would be the kind of small betrayal that stops people curating at all.
  const [alwaysRaw, setAlwaysRaw] = createPersistentSignal<string>('cm:card-wall:always', '', v => v);
  const [offRaw, setOffRaw] = createPersistentSignal<string>('cm:card-wall:off', '', v => v);
  const always = createMemo(() => parseKeys(alwaysRaw()));
  const off = createMemo(() => parseKeys(offRaw()));

  const [background, setBackground] = createSignal<WallLook['background']>('cream');
  const [blur, setBlur] = createSignal(0);
  const [darken, setDarken] = createSignal(0);

  const [format, setFormat] = createSignal<Format>('gif');
  const [exportWidth, setExportWidth] = createSignal(640);
  const [gifFps, setGifFps] = createSignal(20);
  const [videoFps, setVideoFps] = createSignal(30);
  const fps = () => (format() === 'gif' ? gifFps() : videoFps());
  const [loops, setLoops] = createSignal(2);
  const [colors, setColors] = createSignal(128);
  const [lastSize, setLastSize] = createSignal<number | null>(null);

  const [playing, setPlaying] = createSignal(true);
  const [images, setImages] = createSignal<WallImages>(new Map());
  const [loadedCount, setLoadedCount] = createSignal(0);
  const [busy, setBusy] = createSignal(false);
  const [progress, setProgress] = createSignal(0);
  const [error, setError] = createSignal<string | null>(null);
  const [stageSize, setStageSize] = createSignal({ width: 960, height: 540 });

  let canvasRef: HTMLCanvasElement | undefined;
  let stageRef: HTMLDivElement | undefined;
  let abort: AbortController | null = null;
  const painter = createWallPainter();

  const config = createMemo<WallConfig>(() => ({
    rows: rows(),
    cardsPerRow: cardsPerRow(),
    loopSeconds: loopSeconds(),
    gap: gap(),
    cardScale: cardScale(),
    rowSettings: rowSettings().slice(0, rows()),
    seed: seed()
  }));
  const look = createMemo<WallLook>(() => ({ background: background(), blur: blur(), darken: darken() }));

  const deal = createMemo<WallDeal>(() => {
    const pinned = always();
    const excluded = off();
    const usable = WALL_ROSTER.filter(card => !excluded.has(cardKey(card)));
    // Everything switched off leaves nothing to draw, so fall back to the whole
    // roster rather than show an empty stage the user has to guess their way out of.
    const pool = usable.length > 0 ? usable : WALL_ROSTER;
    return {
      always: pool.filter(card => pinned.has(cardKey(card))),
      rest: pool.filter(card => !pinned.has(cardKey(card)))
    };
  });

  const scene = createMemo(() => {
    const size = stageSize();
    return buildScene(config(), deal(), size.width, size.height);
  });
  const exportHeight = createMemo(() => Math.round(exportWidth() / ASPECT[aspect()]));
  const slots = createMemo(() => rows() * cardsPerRow());
  /** Distinct cards the current shuffle actually put on the wall. */
  const onWall = createMemo(() => new Set(scene().rows.flatMap(row => row.cards.map(cardKey))).size);
  const frameCount = createMemo(() => gifFrameCount(scene().loopSeconds, fps()));
  const ready = createMemo(() => loadedCount() >= WALL_ROSTER.length);
  // What a video export would actually produce here: MP4 encoded offline where
  // WebCodecs can, a real-time recording where it can't.
  const [videoOutput] = createResource(
    () => (format() === 'video' ? ([exportWidth(), exportHeight(), videoFps()] as const) : null),
    ([w, h, rate]) => describeVideoOutput(w, h, rate)
  );
  const estimatedMb = createMemo(
    () => estimateGifBytes(frameCount(), exportWidth(), exportHeight(), colors()) / 1_000_000
  );

  onMount(() => {
    document.title = 'Card Wall — Tools — Ciphermaniac';
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setPlaying(false);
    }
    void loadWallImages(WALL_ROSTER, done => setLoadedCount(done)).then(setImages);
  });

  // Backing store tracks the element's real pixel size, so the preview is the
  // same scene the export renders — just at a different resolution.
  onMount(() => {
    const el = stageRef;
    if (!el || typeof ResizeObserver === 'undefined') {
      return;
    }
    const ratio = Math.min(MAX_PIXEL_RATIO, window.devicePixelRatio || 1);
    const observer = new ResizeObserver(entries => {
      const box = entries[0]?.contentRect;
      if (box && box.width > 0) {
        setStageSize({ width: Math.round(box.width * ratio), height: Math.round(box.height * ratio) });
      }
    });
    observer.observe(el);
    onCleanup(() => observer.disconnect());
  });

  onMount(() => mountPreview({ canvas: () => canvasRef, playing, scene, images, look, painter }));

  function applyPreset(preset: Preset) {
    const next = preset.config;
    if (next.rows !== undefined) {
      setRows(next.rows);
    }
    if (next.cardsPerRow !== undefined) {
      setCardsPerRow(next.cardsPerRow);
    }
    if (next.loopSeconds !== undefined) {
      setLoopSeconds(next.loopSeconds);
    }
    if (next.gap !== undefined) {
      setGap(next.gap);
    }
    if (next.cardScale !== undefined) {
      setCardScale(next.cardScale);
    }
    setBlur(preset.look.blur ?? 0);
    setDarken(preset.look.darken ?? 0);
    setRowSettings(prev =>
      prev.map((row, i) => ({ ...row, direction: preset.directions?.[i] ?? (i % 2 === 0 ? 'left' : 'right') }))
    );
  }

  function setRow(index: number, patch: Partial<RowSetting>) {
    setRowSettings(prev => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  async function runExport() {
    if (busy()) {
      abort?.abort();
      return;
    }
    setError(null);
    setBusy(true);
    setProgress(0);
    setLastSize(null);
    abort = new AbortController();
    const width = exportWidth();
    const height = exportHeight();
    const request = {
      config: config(),
      deal: deal(),
      images: images(),
      look: look(),
      width,
      height,
      fps: fps(),
      maxColors: colors(),
      onProgress: (done: number, total: number) => setProgress(total > 0 ? done / total : 0),
      signal: abort.signal
    };
    try {
      const result = format() === 'gif' ? await exportGif(request) : await exportVideo({ ...request, loops: loops() });
      setLastSize(result.blob.size);
      downloadBlob(result.blob, `card-wall-${rows()}x${cardsPerRow()}-${width}x${height}.${result.extension}`);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        console.error(err);
        setError(err instanceof Error ? err.message : 'Export failed');
      }
    } finally {
      abort = null;
      setBusy(false);
      setProgress(0);
    }
  }

  return {
    applyPreset,
    aspect,
    setAspect,
    background,
    setBackground,
    rows,
    setRows,
    cardsPerRow,
    setCardsPerRow,
    loopSeconds,
    setLoopSeconds,
    cardScale,
    setCardScale,
    gap,
    setGap,
    blur,
    setBlur,
    darken,
    setDarken,
    rowSettings,
    setRow,
    onWall,
    off,
    slots,
    always,
    setOffRaw,
    setAlwaysRaw,
    format,
    setFormat,
    exportWidth,
    exportHeight,
    setExportWidth,
    fps,
    setGifFps,
    setVideoFps,
    colors,
    setColors,
    loops,
    setLoops,
    ready,
    runExport,
    busy,
    progress,
    lastSize,
    videoOutput,
    scene,
    frameCount,
    estimatedMb,
    error,
    stageSize,
    loadedCount,
    setPlaying,
    playing,
    setSeed,
    setStageRef: (el: HTMLDivElement) => {
      stageRef = el;
    },
    setCanvasRef: (el: HTMLCanvasElement) => {
      canvasRef = el;
    }
  };
}

interface PreviewOptions {
  canvas: () => HTMLCanvasElement | undefined;
  playing: () => boolean;
  scene: () => WallScene;
  images: () => WallImages;
  look: () => WallLook;
  painter: WallPainter;
}

function mountPreview({ canvas, playing, scene, images, look, painter }: PreviewOptions) {
  let raf: number | null = null;
  let last: number | null = null;
  let t = 0;
  const scheduleFrame = () => {
    if (raf === null && !document.hidden) {
      raf = requestAnimationFrame(frame);
    }
  };
  const frame = (now: number) => {
    raf = null;
    if (document.hidden) {
      last = null;
      return;
    }
    const delta = last === null ? 0 : (now - last) / 1000;
    last = now;
    const current = scene();
    if (playing()) {
      t = (t + delta) % current.loopSeconds;
    }
    const element = canvas();
    const ctx = element?.getContext('2d');
    if (element && ctx) {
      painter.paint(ctx, current, images(), t % current.loopSeconds, element.width, element.height, look());
    }
    if (playing()) {
      scheduleFrame();
    } else {
      last = null;
    }
  };
  const stop = () => {
    if (raf !== null) {
      cancelAnimationFrame(raf);
      raf = null;
    }
    last = null;
  };
  const visibilityChanged = () => {
    stop();
    scheduleFrame();
  };
  // Paused previews still need one frame when their inputs change. Coalesce
  // those changes into the pending frame, then sleep until the next change.
  createEffect(() => {
    playing();
    scene();
    images();
    look();
    scheduleFrame();
  });
  document.addEventListener('visibilitychange', visibilityChanged);
  onCleanup(() => {
    stop();
    document.removeEventListener('visibilitychange', visibilityChanged);
  });
}

type CardWallModel = ReturnType<typeof useCardWall>;

function WallControls(model: CardWallModel) {
  return (
    <>
      <div class='cw-presets'>
        <For each={PRESETS}>
          {preset => (
            <button type='button' class='btn btn-ghost' onClick={() => model.applyPreset(preset)}>
              {preset.label}
            </button>
          )}
        </For>
      </div>

      <div class='cw-fields'>
        <div class='cw-field'>
          <span class='cw-field-label'>Shape</span>
          <Segmented
            options={ASPECT_OPTIONS}
            selected={model.aspect()}
            onSelect={model.setAspect}
            ariaLabel='Aspect ratio'
          />
        </div>
        <div class='cw-field'>
          <span class='cw-field-label'>Background</span>
          <Segmented
            options={BACKGROUND_OPTIONS}
            selected={model.background()}
            onSelect={model.setBackground}
            ariaLabel='Background'
          />
        </div>
        <label class='cw-field'>
          <span class='cw-field-label'>
            Rows <b>{model.rows()}</b>
          </span>
          <input
            type='range'
            min='2'
            max={MAX_ROWS}
            step='1'
            value={model.rows()}
            onInput={e => model.setRows(Number(e.currentTarget.value))}
          />
        </label>
        <label class='cw-field'>
          <span class='cw-field-label'>
            Cards per row <b>{model.cardsPerRow()}</b>
          </span>
          <input
            type='range'
            min='3'
            max='14'
            step='1'
            value={model.cardsPerRow()}
            onInput={e => model.setCardsPerRow(Number(e.currentTarget.value))}
          />
        </label>
        <label class='cw-field'>
          <span class='cw-field-label'>
            Loop <b>{formatLoop(model.loopSeconds())}</b>
          </span>
          <input
            type='range'
            min='2'
            max='60'
            step='0.5'
            value={model.loopSeconds()}
            onInput={e => model.setLoopSeconds(Number(e.currentTarget.value))}
          />
        </label>
        <label class='cw-field'>
          <span class='cw-field-label'>
            Card size <b>{Math.round(model.cardScale() * 100)}%</b>
          </span>
          <input
            type='range'
            min='0.5'
            max='1'
            step='0.02'
            value={model.cardScale()}
            onInput={e => model.setCardScale(Number(e.currentTarget.value))}
          />
        </label>
        <label class='cw-field'>
          <span class='cw-field-label'>
            Spacing <b>{Math.round(model.gap() * 100)}%</b>
          </span>
          <input
            type='range'
            min='0'
            max='0.4'
            step='0.01'
            value={model.gap()}
            onInput={e => model.setGap(Number(e.currentTarget.value))}
          />
        </label>
        <label class='cw-field'>
          <span class='cw-field-label'>
            Blur <b>{model.blur()}</b>
          </span>
          <input
            type='range'
            min='0'
            max='40'
            step='1'
            value={model.blur()}
            onInput={e => model.setBlur(Number(e.currentTarget.value))}
          />
        </label>
        <label class='cw-field'>
          <span class='cw-field-label'>
            Darken <b>{Math.round(model.darken() * 100)}%</b>
          </span>
          <input
            type='range'
            min='0'
            max='0.8'
            step='0.02'
            value={model.darken()}
            onInput={e => model.setDarken(Number(e.currentTarget.value))}
          />
        </label>
      </div>

      <div class='cw-rows'>
        <For each={model.rowSettings().slice(0, model.rows())}>
          {(row, i) => (
            <div class='cw-row'>
              <span class='cw-row-name'>Row {i() + 1}</span>
              <div class='segmented' role='group' aria-label={`Row ${i() + 1} direction`}>
                <button
                  type='button'
                  class={row.direction === 'left' ? 'active' : ''}
                  onClick={() => model.setRow(i(), { direction: 'left' })}
                >
                  &larr;
                </button>
                <button
                  type='button'
                  class={row.direction === 'right' ? 'active' : ''}
                  onClick={() => model.setRow(i(), { direction: 'right' })}
                >
                  &rarr;
                </button>
              </div>
              <div class='segmented' role='group' aria-label={`Row ${i() + 1} speed`}>
                <For each={[1, 2, 3]}>
                  {lap => (
                    <button
                      type='button'
                      class={row.laps === lap ? 'active' : ''}
                      onClick={() => model.setRow(i(), { laps: lap })}
                    >
                      {lap}&times;
                    </button>
                  )}
                </For>
              </div>
            </div>
          )}
        </For>
      </div>
    </>
  );
}

function WallCards(model: CardWallModel) {
  return (
    <>
      <div class='cw-cards'>
        <div class='cw-cards-head'>
          <span class='cw-field-label'>Cards</span>
          <span class='cw-readout'>
            {model.onWall()} of {WALL_ROSTER.length - model.off().size} on {model.slots()} slots
            <Show when={model.always().size > 0}> · {model.always().size} always</Show>
          </span>
          <div class='cw-cards-actions'>
            <button
              type='button'
              class='btn btn-ghost'
              onClick={() => model.setOffRaw('')}
              disabled={model.off().size === 0}
            >
              Use all
            </button>
            <button
              type='button'
              class='btn btn-ghost'
              onClick={() => model.setAlwaysRaw('')}
              disabled={model.always().size === 0}
            >
              Clear always
            </button>
          </div>
        </div>
        <Show when={model.always().size > model.slots()}>
          <p class='cw-error' role='status'>
            {model.always().size} cards are set to always appear, but the wall only has {model.slots()} slots. Add rows
            or cards per row, or some of them will still miss out.
          </p>
        </Show>
        <div class='cw-card-grid'>
          <For each={WALL_ROSTER}>
            {card => {
              const key = cardKey(card);
              return (
                <div
                  class='cw-card'
                  classList={{ 'is-off': model.off().has(key), 'is-always': model.always().has(key) }}
                >
                  <button
                    type='button'
                    class='cw-card-pin'
                    aria-pressed={model.always().has(key)}
                    aria-label={`Always include ${card.name}`}
                    title='Always include this card'
                    onClick={() => model.setAlwaysRaw(prev => toggleKey(prev, key))}
                  />
                  <button
                    type='button'
                    class='cw-card-name'
                    aria-pressed={!model.off().has(key)}
                    onClick={() => model.setOffRaw(prev => toggleKey(prev, key))}
                  >
                    {card.name}
                  </button>
                </div>
              );
            }}
          </For>
        </div>
      </div>
    </>
  );
}

function WallExport(model: CardWallModel) {
  return (
    <>
      <div class='cw-export'>
        <div class='cw-field'>
          <span class='cw-field-label'>Format</span>
          <Segmented
            options={FORMAT_OPTIONS}
            selected={model.format()}
            onSelect={model.setFormat}
            ariaLabel='Export format'
          />
        </div>
        <div class='cw-field'>
          <span class='cw-field-label'>
            Size{' '}
            <b>
              {model.exportWidth()}&times;{model.exportHeight()}
            </b>
          </span>
          <Segmented
            options={WIDTH_OPTIONS.map(w => ({ value: String(w), label: String(w) }))}
            selected={String(model.exportWidth())}
            onSelect={value => model.setExportWidth(Number(value))}
            ariaLabel='Export width'
          />
        </div>
        <div class='cw-field'>
          <span class='cw-field-label'>Frame rate</span>
          <Segmented
            options={(model.format() === 'gif' ? GIF_FPS_OPTIONS : VIDEO_FPS_OPTIONS).map(f => ({
              value: String(f),
              label: String(f)
            }))}
            selected={String(model.fps())}
            onSelect={value =>
              model.format() === 'gif' ? model.setGifFps(Number(value)) : model.setVideoFps(Number(value))
            }
            ariaLabel='Frames per second'
          />
        </div>
        <Show when={model.format() === 'gif'}>
          <div class='cw-field'>
            <span class='cw-field-label'>Colours</span>
            <Segmented
              options={COLOR_OPTIONS.map(c => ({ value: String(c), label: String(c) }))}
              selected={String(model.colors())}
              onSelect={value => model.setColors(Number(value))}
              ariaLabel='Colours in the GIF palette'
            />
          </div>
        </Show>
        <Show when={model.format() === 'video'}>
          <label class='cw-field'>
            <span class='cw-field-label'>
              Loops <b>{model.loops()}</b>
            </span>
            <input
              type='range'
              min='1'
              max='6'
              step='1'
              value={model.loops()}
              onInput={e => model.setLoops(Number(e.currentTarget.value))}
            />
          </label>
        </Show>
        <div class='cw-export-action'>
          <button
            type='button'
            class='btn btn-primary'
            disabled={!model.ready()}
            onClick={() => void model.runExport()}
          >
            {model.busy() ? 'Cancel' : 'Export'}
          </button>
          <Show when={model.busy()}>
            <span class='cw-readout'>{Math.round(model.progress() * 100)}%</span>
          </Show>
          <Show when={model.format() === 'video' && model.busy()}>
            <span class='cw-readout'>recording in real time</span>
          </Show>
          <Show when={!model.busy() && model.lastSize() !== null}>
            <span class='cw-readout'>{(model.lastSize()! / 1_000_000).toFixed(1)} MB</span>
          </Show>
        </div>
      </div>

      <p class='cw-note muted'>
        <Show
          when={model.format() === 'gif'}
          fallback={
            <Show
              when={model.videoOutput()}
              fallback={
                <Show
                  when={model.videoOutput.loading}
                  fallback={<>This browser can neither encode nor record video — use the GIF export.</>}
                >
                  Checking what this browser can encode&hellip;
                </Show>
              }
            >
              {out => (
                <>
                  {formatSeconds(model.scene().loopSeconds * model.loops())} of {out().extension.toUpperCase()} at{' '}
                  {model.exportWidth()}
                  &times;{model.exportHeight()}.{' '}
                  {out().realtime
                    ? 'This browser has no H.264 encoder, so the clip is recorded as it plays — it takes as long as it runs, and the tab has to stay in front.'
                    : 'Encoded offline, so it finishes faster than it plays.'}
                </>
              )}
            </Show>
          }
        >
          {model.frameCount()} frames at {model.exportWidth()}&times;{model.exportHeight()}, roughly{' '}
          {model.estimatedMb() >= 10 ? Math.round(model.estimatedMb()) : model.estimatedMb().toFixed(1)} MB. A shorter
          loop is a proportionally smaller file; more cards per row just scrolls faster.
        </Show>
      </p>

      <Show when={model.error()}>
        <p class='cw-error' role='alert'>
          {model.error()}
        </p>
      </Show>
    </>
  );
}

export function CardWallPage() {
  const model = useCardWall();
  return (
    <div class='cw-page'>
      <section class='hero'>
        <h1>Card Wall</h1>
        <div class='hero-meta'>
          <span>Scroll the cards defining the format past each other, and save the loop</span>
        </div>
      </section>

      <section>
        <div class='cw-stage-frame' style={{ '--cw-aspect': String(ASPECT[model.aspect()]) }} ref={model.setStageRef}>
          <canvas
            class='cw-canvas'
            ref={model.setCanvasRef}
            width={model.stageSize().width}
            height={model.stageSize().height}
            role='img'
            aria-label={`${model.rows()} rows of scrolling Pokemon card art`}
          />
          <Show when={!model.ready()}>
            <div class='cw-loading'>
              {model.loadedCount()} / {WALL_ROSTER.length}
            </div>
          </Show>
        </div>

        <div class='cw-stage-bar'>
          <button type='button' class='btn btn-secondary' onClick={() => model.setPlaying(p => !p)}>
            {model.playing() ? 'Pause' : 'Play'}
          </button>
          <button type='button' class='btn btn-secondary' onClick={() => model.setSeed(s => s + 1)}>
            Shuffle
          </button>
          <span class='cw-readout'>
            {model.scene().cardsPerSecond.toFixed(1)} cards/sec
            <Show when={model.format() === 'gif'}> · {model.frameCount()} frames</Show>
          </span>
        </div>
      </section>

      <section class='cw-panel'>
        <WallControls {...model} />
        <WallCards {...model} />
        <WallExport {...model} />
      </section>
    </div>
  );
}
