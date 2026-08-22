import { createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { loadWallImages, type WallImages } from '../lib/cardWall/images';
import { buildScene, type RowSetting, type WallConfig } from '../lib/cardWall/scene';
import { createWallPainter, type WallLook } from '../lib/cardWall/render';
import {
  downloadBlob,
  estimateGifBytes,
  exportGif,
  exportVideo,
  gifFrameCount,
  pickVideoType
} from '../lib/cardWall/export';
import { WALL_ROSTER } from '../lib/cardWall/roster';
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
const FPS_OPTIONS = [15, 20, 25, 30];
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

export function CardWallPage() {
  const [aspect, setAspect] = createSignal<AspectKey>('16:9');
  const [rows, setRows] = createSignal(4);
  const [cardsPerRow, setCardsPerRow] = createSignal(8);
  const [loopSeconds, setLoopSeconds] = createSignal(10);
  const [gap, setGap] = createSignal(0.1);
  const [cardScale, setCardScale] = createSignal(0.84);
  const [seed, setSeed] = createSignal(7);
  const [rowSettings, setRowSettings] = createSignal<RowSetting[]>(defaultRowSettings());

  const [background, setBackground] = createSignal<WallLook['background']>('cream');
  const [blur, setBlur] = createSignal(0);
  const [darken, setDarken] = createSignal(0);

  const [format, setFormat] = createSignal<Format>('gif');
  const [exportWidth, setExportWidth] = createSignal(640);
  const [fps, setFps] = createSignal(15);
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

  const scene = createMemo(() => {
    const size = stageSize();
    return buildScene(config(), WALL_ROSTER, size.width, size.height);
  });
  const exportHeight = createMemo(() => Math.round(exportWidth() / ASPECT[aspect()]));
  const frameCount = createMemo(() => gifFrameCount(scene().loopSeconds, fps()));
  const ready = createMemo(() => loadedCount() >= WALL_ROSTER.length);
  const videoType = createMemo(() => pickVideoType());
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

  onMount(() => {
    let raf = 0;
    let last = performance.now();
    let t = 0;
    const frame = (now: number) => {
      const delta = (now - last) / 1000;
      last = now;
      const current = scene();
      if (playing()) {
        t = (t + delta) % current.loopSeconds;
      }
      const canvas = canvasRef;
      const ctx = canvas?.getContext('2d');
      if (canvas && ctx) {
        painter.paint(ctx, current, images(), t % current.loopSeconds, canvas.width, canvas.height, look());
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    onCleanup(() => cancelAnimationFrame(raf));
  });

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
      roster: WALL_ROSTER,
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

  return (
    <div class='cw-page'>
      <section class='hero'>
        <h1>Card Wall</h1>
        <div class='hero-meta'>
          <span>Scroll the cards defining the format past each other, and save the loop</span>
        </div>
      </section>

      <section>
        <div class='cw-stage-frame' style={{ '--cw-aspect': String(ASPECT[aspect()]) }} ref={stageRef}>
          <canvas
            class='cw-canvas'
            ref={canvasRef}
            width={stageSize().width}
            height={stageSize().height}
            role='img'
            aria-label={`${rows()} rows of scrolling Pokemon card art`}
          />
          <Show when={!ready()}>
            <div class='cw-loading'>
              {loadedCount()} / {WALL_ROSTER.length}
            </div>
          </Show>
        </div>

        <div class='cw-stage-bar'>
          <button type='button' class='btn btn-secondary' onClick={() => setPlaying(p => !p)}>
            {playing() ? 'Pause' : 'Play'}
          </button>
          <button type='button' class='btn btn-secondary' onClick={() => setSeed(s => s + 1)}>
            Shuffle
          </button>
          <span class='cw-readout'>
            {scene().cardsPerSecond.toFixed(1)} cards/sec
            <Show when={format() === 'gif'}> · {frameCount()} frames</Show>
          </span>
        </div>
      </section>

      <section class='cw-panel'>
        <div class='cw-presets'>
          <For each={PRESETS}>
            {preset => (
              <button type='button' class='btn btn-ghost' onClick={() => applyPreset(preset)}>
                {preset.label}
              </button>
            )}
          </For>
        </div>

        <div class='cw-fields'>
          <div class='cw-field'>
            <span class='cw-field-label'>Shape</span>
            <Segmented options={ASPECT_OPTIONS} selected={aspect()} onSelect={setAspect} ariaLabel='Aspect ratio' />
          </div>
          <div class='cw-field'>
            <span class='cw-field-label'>Background</span>
            <Segmented
              options={BACKGROUND_OPTIONS}
              selected={background()}
              onSelect={setBackground}
              ariaLabel='Background'
            />
          </div>
          <label class='cw-field'>
            <span class='cw-field-label'>
              Rows <b>{rows()}</b>
            </span>
            <input
              type='range'
              min='2'
              max={MAX_ROWS}
              step='1'
              value={rows()}
              onInput={e => setRows(Number(e.currentTarget.value))}
            />
          </label>
          <label class='cw-field'>
            <span class='cw-field-label'>
              Cards per row <b>{cardsPerRow()}</b>
            </span>
            <input
              type='range'
              min='3'
              max='14'
              step='1'
              value={cardsPerRow()}
              onInput={e => setCardsPerRow(Number(e.currentTarget.value))}
            />
          </label>
          <label class='cw-field'>
            <span class='cw-field-label'>
              Loop <b>{formatLoop(loopSeconds())}</b>
            </span>
            <input
              type='range'
              min='2'
              max='60'
              step='0.5'
              value={loopSeconds()}
              onInput={e => setLoopSeconds(Number(e.currentTarget.value))}
            />
          </label>
          <label class='cw-field'>
            <span class='cw-field-label'>
              Card size <b>{Math.round(cardScale() * 100)}%</b>
            </span>
            <input
              type='range'
              min='0.5'
              max='1'
              step='0.02'
              value={cardScale()}
              onInput={e => setCardScale(Number(e.currentTarget.value))}
            />
          </label>
          <label class='cw-field'>
            <span class='cw-field-label'>
              Spacing <b>{Math.round(gap() * 100)}%</b>
            </span>
            <input
              type='range'
              min='0'
              max='0.4'
              step='0.01'
              value={gap()}
              onInput={e => setGap(Number(e.currentTarget.value))}
            />
          </label>
          <label class='cw-field'>
            <span class='cw-field-label'>
              Blur <b>{blur()}</b>
            </span>
            <input
              type='range'
              min='0'
              max='40'
              step='1'
              value={blur()}
              onInput={e => setBlur(Number(e.currentTarget.value))}
            />
          </label>
          <label class='cw-field'>
            <span class='cw-field-label'>
              Darken <b>{Math.round(darken() * 100)}%</b>
            </span>
            <input
              type='range'
              min='0'
              max='0.8'
              step='0.02'
              value={darken()}
              onInput={e => setDarken(Number(e.currentTarget.value))}
            />
          </label>
        </div>

        <div class='cw-rows'>
          <For each={rowSettings().slice(0, rows())}>
            {(row, i) => (
              <div class='cw-row'>
                <span class='cw-row-name'>Row {i() + 1}</span>
                <div class='segmented' role='group' aria-label={`Row ${i() + 1} direction`}>
                  <button
                    type='button'
                    class={row.direction === 'left' ? 'active' : ''}
                    onClick={() => setRow(i(), { direction: 'left' })}
                  >
                    &larr;
                  </button>
                  <button
                    type='button'
                    class={row.direction === 'right' ? 'active' : ''}
                    onClick={() => setRow(i(), { direction: 'right' })}
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
                        onClick={() => setRow(i(), { laps: lap })}
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

        <div class='cw-export'>
          <div class='cw-field'>
            <span class='cw-field-label'>Format</span>
            <Segmented options={FORMAT_OPTIONS} selected={format()} onSelect={setFormat} ariaLabel='Export format' />
          </div>
          <div class='cw-field'>
            <span class='cw-field-label'>
              Size{' '}
              <b>
                {exportWidth()}&times;{exportHeight()}
              </b>
            </span>
            <Segmented
              options={WIDTH_OPTIONS.map(w => ({ value: String(w), label: String(w) }))}
              selected={String(exportWidth())}
              onSelect={value => setExportWidth(Number(value))}
              ariaLabel='Export width'
            />
          </div>
          <div class='cw-field'>
            <span class='cw-field-label'>Frame rate</span>
            <Segmented
              options={FPS_OPTIONS.map(f => ({ value: String(f), label: String(f) }))}
              selected={String(fps())}
              onSelect={value => setFps(Number(value))}
              ariaLabel='Frames per second'
            />
          </div>
          <Show when={format() === 'gif'}>
            <div class='cw-field'>
              <span class='cw-field-label'>Colours</span>
              <Segmented
                options={COLOR_OPTIONS.map(c => ({ value: String(c), label: String(c) }))}
                selected={String(colors())}
                onSelect={value => setColors(Number(value))}
                ariaLabel='Colours in the GIF palette'
              />
            </div>
          </Show>
          <Show when={format() === 'video'}>
            <label class='cw-field'>
              <span class='cw-field-label'>
                Loops <b>{loops()}</b>
              </span>
              <input
                type='range'
                min='1'
                max='6'
                step='1'
                value={loops()}
                onInput={e => setLoops(Number(e.currentTarget.value))}
              />
            </label>
          </Show>
          <div class='cw-export-action'>
            <button type='button' class='btn btn-primary' disabled={!ready()} onClick={() => void runExport()}>
              {busy() ? 'Cancel' : 'Export'}
            </button>
            <Show when={busy()}>
              <span class='cw-readout'>{Math.round(progress() * 100)}%</span>
            </Show>
            <Show when={format() === 'video' && busy()}>
              <span class='cw-readout'>recording in real time</span>
            </Show>
            <Show when={!busy() && lastSize() !== null}>
              <span class='cw-readout'>{(lastSize()! / 1_000_000).toFixed(1)} MB</span>
            </Show>
          </div>
        </div>

        <p class='cw-note muted'>
          <Show
            when={format() === 'gif'}
            fallback={
              <Show
                when={videoType()}
                fallback={<>This browser can't record video from a canvas — use the GIF export.</>}
              >
                {type => (
                  <>
                    Records at {formatSeconds(scene().loopSeconds * loops())}, in real time, as{' '}
                    {type().startsWith('video/mp4') ? 'MP4' : 'WebM'}. Keep the tab in front.
                  </>
                )}
              </Show>
            }
          >
            {frameCount()} frames at {exportWidth()}&times;{exportHeight()}, roughly{' '}
            {estimatedMb() >= 10 ? Math.round(estimatedMb()) : estimatedMb().toFixed(1)} MB. A shorter loop is a
            proportionally smaller file; more cards per row just scrolls faster.
          </Show>
        </p>

        <Show when={error()}>
          <p class='cw-error' role='alert'>
            {error()}
          </p>
        </Show>
      </section>
    </div>
  );
}
