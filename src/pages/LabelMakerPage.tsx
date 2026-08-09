import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import { Segmented } from '../components/Segmented';
import { PokemonPicker, prettySlugName } from '../components/PokemonPicker';
import { defaultConfig, type LabelConfig } from '../lib/labelmaker/types';
import { renderLabel } from '../lib/labelmaker/renderLabel';
import { dimsForLabel, type LabelDims, mmToDots, PRINTERS } from '../lib/labelmaker/printers';
import '../styles/pages/label-maker.css';

const LAYOUT_OPTIONS = [
  { value: 'keepsake' as const, label: 'Keepsake' },
  { value: 'ticket' as const, label: 'Ticket' }
];
const THIRD_ROW_OPTIONS = [
  { value: 'none' as const, label: 'None' },
  { value: 'stars' as const, label: 'Stars' },
  { value: 'progress' as const, label: 'Progress' },
  { value: 'text' as const, label: 'Text' }
];
const STUB_OPTIONS = [
  { value: 'stars' as const, label: 'Stars + format' },
  { value: 'progress' as const, label: 'Build meter' },
  { value: 'count' as const, label: 'Big count' }
];
const SPRITE_SIDE_OPTIONS = [
  { value: 'left' as const, label: 'Left' },
  { value: 'right' as const, label: 'Right' }
];
const DUO_SIZING_OPTIONS = [
  { value: 'primary-larger' as const, label: 'Emphasize first' },
  { value: 'equal' as const, label: 'Equal' }
];
const SUBTITLE_STYLE_OPTIONS = [
  { value: 'italic' as const, label: 'Italic' },
  { value: 'regular' as const, label: 'Regular' },
  { value: 'caps' as const, label: 'Caps' }
];

const CUSTOM_PRINTER = 'custom';

export function LabelMakerPage() {
  const [config, setConfig] = createStore<LabelConfig>({ ...defaultConfig });
  // The title auto-follows the Pokémon selection until the user types over it,
  // at which point it's theirs and we stop touching it.
  const [titleEdited, setTitleEdited] = createSignal(false);
  const [printerId, setPrinterId] = createSignal('ql800');
  const [labelId, setLabelId] = createSignal('dk1209');
  const [custom, setCustom] = createStore({ enabled: false, dpi: 300, wMm: 62, hMm: 29 });
  const [error, setError] = createSignal<string | null>(null);

  let canvasRef: HTMLCanvasElement | undefined;

  // Desktop tool. The output is a physical label going to a USB thermal
  // printer, so the phone can't finish the job even when the UI fits — and the
  // preview needs to be read at print scale to judge whether the dither and
  // the fitted title actually work. Same call as Social Graphics.
  const narrowQuery = typeof window !== 'undefined' ? window.matchMedia('(max-width: 899px)') : null;
  const [isNarrow, setIsNarrow] = createSignal(narrowQuery?.matches ?? false);
  onMount(() => {
    const onChange = (e: MediaQueryListEvent) => setIsNarrow(e.matches);
    narrowQuery?.addEventListener('change', onChange);
    onCleanup(() => narrowQuery?.removeEventListener('change', onChange));
  });

  onMount(() => {
    document.title = 'Deck Box Label Maker — Tools — Ciphermaniac';
  });

  const currentPrinter = () => PRINTERS.find(p => p.id === printerId()) ?? PRINTERS[0];

  const dims = createMemo<LabelDims>(() => {
    if (custom.enabled) {
      const dpi = Math.max(72, custom.dpi || 300);
      const wMm = Math.max(10, custom.wMm || 62);
      const hMm = Math.max(10, custom.hMm || 29);
      return { dpi, wMm, hMm, wDots: mmToDots(wMm, dpi), hDots: mmToDots(hMm, dpi) };
    }
    const printer = currentPrinter();
    const label = printer.labels.find(l => l.id === labelId()) ?? printer.labels[0];
    return dimsForLabel(printer.dpi, label);
  });

  const autoTitle = () => {
    if (!config.pokemon1) {
      return '';
    }
    return config.pokemon2
      ? `${prettySlugName(config.pokemon1)} ${prettySlugName(config.pokemon2)}`
      : prettySlugName(config.pokemon1);
  };
  const effectiveTitle = () => (titleEdited() ? config.title : autoTitle());

  const isEmpty = () => !config.pokemon1 && !effectiveTitle().trim() && !config.subtitle.trim();

  createEffect(() => {
    const canvas = canvasRef;
    if (!canvas) {
      return;
    }
    // Reading every field keeps this effect subscribed to the whole store.
    const snapshot: LabelConfig = { ...config, title: effectiveTitle() };
    void renderLabel(canvas, snapshot, dims());
  });

  function fileSlug(): string {
    return effectiveTitle().trim().replace(/\s+/g, '-').toLowerCase() || 'label';
  }

  /** Canvas → data URL, with the taint failure spelled out rather than swallowed. */
  function snapshotPng(): string | null {
    const canvas = canvasRef;
    if (!canvas) {
      return null;
    }
    try {
      const url = canvas.toDataURL('image/png');
      setError(null);
      return url;
    } catch {
      setError('Could not read the label image. Reload the page and try again.');
      return null;
    }
  }

  function download() {
    const data = snapshotPng();
    if (!data) {
      return;
    }
    const a = document.createElement('a');
    a.download = `${fileSlug()}.png`;
    a.href = data;
    a.click();
  }

  function print() {
    const data = snapshotPng();
    if (!data) {
      return;
    }
    const win = window.open('', '_blank');
    if (!win) {
      setError('Your browser blocked the print window. Allow pop-ups for this site, or download the PNG instead.');
      return;
    }
    const d = dims();
    // A bare image at exact physical size with no page margin: the printer
    // driver then has nothing to scale, which is what keeps 1 label dot on
    // 1 printer dot.
    win.document.write(
      `<!doctype html><html><head><title>${fileSlug()}</title><style>` +
        `@page { size: ${d.wMm}mm ${d.hMm}mm; margin: 0; }` +
        'html, body { margin: 0; padding: 0; }' +
        `img { width: ${d.wMm}mm; height: ${d.hMm}mm; display: block; image-rendering: pixelated; }` +
        `</style></head><body><img src="${data}" onload="window.print()"></body></html>`
    );
    win.document.close();
  }

  const showStars = () =>
    (config.layout === 'keepsake' && (config.thirdRow === 'stars' || config.thirdRow === 'progress')) ||
    (config.layout === 'ticket' && config.stubContent === 'stars');
  const showProgress = () =>
    (config.layout === 'keepsake' && config.thirdRow === 'progress') ||
    (config.layout === 'ticket' && config.stubContent !== 'stars');

  return (
    <div class='lm-page'>
      <section class='hero'>
        <h1>Deck Box Label Maker</h1>
        <div class='hero-meta'>
          <span>Built for the Brother QL series, DYMO LabelWriter, and Zebra desktop printers</span>
        </div>
      </section>

      <Show when={isNarrow()}>
        <div class='lm-warning' role='note'>
          <strong>This tool is built for desktop.</strong>
          <span>
            The label preview needs a wide screen to read at print scale, and the finished label goes to a thermal
            printer on a computer anyway. Open this page on a desktop browser to design and print one.
          </span>
        </div>
      </Show>

      <Show when={!isNarrow()}>
        <div class='lm-stage'>
          <div class='lm-paper'>
            <canvas
              ref={canvasRef}
              width={dims().wDots}
              height={dims().hDots}
              style={{ 'aspect-ratio': `${dims().wDots} / ${dims().hDots}`, 'max-width': `${dims().wDots}px` }}
              aria-label='Label preview'
              role='img'
            />
          </div>
          <div class='lm-stage-foot'>
            <span class='lm-dims num'>
              {dims().wDots} × {dims().hDots} dots · {dims().wMm} × {dims().hMm} mm at {dims().dpi} dpi · 1-bit
            </span>
            <div class='lm-actions'>
              <button type='button' class='btn btn-primary' onClick={print} disabled={isEmpty()}>
                Print
              </button>
              <button type='button' class='btn btn-secondary' onClick={download} disabled={isEmpty()}>
                Download PNG
              </button>
            </div>
          </div>
          <Show when={isEmpty()}>
            <p class='lm-hint'>Pick a Pokémon below, or type a title.</p>
          </Show>
          <Show when={error()}>
            <p class='lm-error' role='alert'>
              {error()}
            </p>
          </Show>
        </div>

        <div class='lm-controls'>
          <section class='lm-group'>
            <h2>Pokémon</h2>
            <PokemonPicker
              id='primary'
              label='Pokémon'
              value={config.pokemon1}
              clearable
              onChange={v => {
                // Clearing the first slot promotes the second, so there's never a
                // hole with an icon sitting in the wrong position.
                if (!v && config.pokemon2) {
                  setConfig({ pokemon1: config.pokemon2, pokemon2: null });
                } else {
                  setConfig('pokemon1', v);
                }
              }}
            />
            <Show when={config.pokemon1}>
              <PokemonPicker
                id='secondary'
                label='Add another'
                value={config.pokemon2}
                clearable
                onChange={v => setConfig('pokemon2', v)}
              />
            </Show>
            <Show when={config.pokemon2}>
              <div class='lm-field'>
                <span class='lm-field-label'>Icon sizes</span>
                <Segmented
                  ariaLabel='Icon sizes'
                  options={DUO_SIZING_OPTIONS}
                  selected={config.duoSizing}
                  onSelect={v => setConfig('duoSizing', v)}
                />
              </div>
              <label class='lm-check'>
                <input
                  type='checkbox'
                  checked={config.titleBreak}
                  onChange={e => setConfig('titleBreak', e.currentTarget.checked)}
                />
                Line break between names
              </label>
            </Show>
            <div class='lm-field'>
              <span class='lm-field-label'>Icon side</span>
              <Segmented
                ariaLabel='Icon side'
                options={SPRITE_SIDE_OPTIONS}
                selected={config.spriteSide}
                onSelect={v => setConfig('spriteSide', v)}
              />
            </div>
          </section>

          <section class='lm-group'>
            <h2>Text</h2>
            <div class='lm-field'>
              <label for='lm-title'>Deck title</label>
              <input
                id='lm-title'
                type='text'
                placeholder='Deck title'
                value={effectiveTitle()}
                onInput={e => {
                  setTitleEdited(true);
                  setConfig('title', e.currentTarget.value);
                }}
              />
            </div>
            <div class='lm-field'>
              <label for='lm-subtitle'>Subtitle</label>
              <input
                id='lm-subtitle'
                type='text'
                placeholder='Andrew Hedrick, Standard 2026'
                value={config.subtitle}
                onInput={e => setConfig('subtitle', e.currentTarget.value)}
              />
            </div>
            <div class='lm-field'>
              <span class='lm-field-label'>Subtitle style</span>
              <Segmented
                ariaLabel='Subtitle style'
                options={SUBTITLE_STYLE_OPTIONS}
                selected={config.subtitleStyle}
                onSelect={v => setConfig('subtitleStyle', v)}
              />
            </div>
          </section>

          <section class='lm-group'>
            <h2>Layout</h2>
            <div class='lm-field'>
              <span class='lm-field-label'>Shape</span>
              <Segmented
                ariaLabel='Label layout'
                options={LAYOUT_OPTIONS}
                selected={config.layout}
                onSelect={v => setConfig('layout', v)}
              />
            </div>

            <Show
              when={config.layout === 'keepsake'}
              fallback={
                <div class='lm-field'>
                  <span class='lm-field-label'>Stub content</span>
                  <Segmented
                    ariaLabel='Stub content'
                    options={STUB_OPTIONS}
                    selected={config.stubContent}
                    onSelect={v => setConfig('stubContent', v)}
                  />
                </div>
              }
            >
              <div class='lm-field'>
                <span class='lm-field-label'>Third row</span>
                <Segmented
                  ariaLabel='Third row'
                  options={THIRD_ROW_OPTIONS}
                  selected={config.thirdRow}
                  onSelect={v => setConfig('thirdRow', v)}
                />
              </div>
            </Show>

            <Show when={showStars()}>
              <div class='lm-field'>
                <label for='lm-stars'>
                  Stars: {config.stars} of {config.starsMax}
                </label>
                <input
                  id='lm-stars'
                  type='range'
                  min={0}
                  max={config.starsMax}
                  value={config.stars}
                  onInput={e => setConfig('stars', Number(e.currentTarget.value))}
                />
              </div>
            </Show>

            <Show when={showProgress()}>
              <div class='lm-field'>
                <span class='lm-field-label'>Progress</span>
                <div class='lm-pair'>
                  <input
                    type='number'
                    min={0}
                    aria-label='Cards built'
                    value={config.progressCurrent}
                    onInput={e => setConfig('progressCurrent', Number(e.currentTarget.value))}
                  />
                  <span aria-hidden='true'>/</span>
                  <input
                    type='number'
                    min={1}
                    aria-label='Cards total'
                    value={config.progressTotal}
                    onInput={e => setConfig('progressTotal', Number(e.currentTarget.value))}
                  />
                </div>
              </div>
            </Show>

            <Show when={config.layout === 'keepsake' && config.thirdRow === 'text'}>
              <div class='lm-field'>
                <label for='lm-extra'>Extra text</label>
                <input
                  id='lm-extra'
                  type='text'
                  value={config.extraText}
                  onInput={e => setConfig('extraText', e.currentTarget.value)}
                />
              </div>
            </Show>

            <Show when={config.layout === 'ticket' && config.stubContent === 'stars'}>
              <div class='lm-field'>
                <label for='lm-stub-label'>Stub label</label>
                <input
                  id='lm-stub-label'
                  type='text'
                  value={config.stubLabel}
                  onInput={e => setConfig('stubLabel', e.currentTarget.value)}
                />
              </div>
              <div class='lm-field'>
                <label for='lm-format'>Format</label>
                <input
                  id='lm-format'
                  type='text'
                  value={config.formatText}
                  onInput={e => setConfig('formatText', e.currentTarget.value)}
                />
              </div>
            </Show>
          </section>

          {/* Printer last on purpose: it's a set-once decision, and putting it
            first made every visitor scroll past it to reach the actual design. */}
          <section class='lm-group'>
            <h2>Printer</h2>
            <div class='lm-field'>
              <label for='lm-printer'>Model</label>
              <select
                id='lm-printer'
                value={custom.enabled ? CUSTOM_PRINTER : printerId()}
                onChange={e => {
                  const v = e.currentTarget.value;
                  if (v === CUSTOM_PRINTER) {
                    setCustom('enabled', true);
                    return;
                  }
                  setCustom('enabled', false);
                  setPrinterId(v);
                  const p = PRINTERS.find(x => x.id === v);
                  if (p && !p.labels.some(l => l.id === labelId())) {
                    setLabelId(p.labels[0].id);
                  }
                }}
              >
                <For each={PRINTERS}>{p => <option value={p.id}>{p.name}</option>}</For>
                <option value={CUSTOM_PRINTER}>Custom…</option>
              </select>
            </div>

            <Show
              when={custom.enabled}
              fallback={
                <div class='lm-field'>
                  <label for='lm-label-size'>Label size</label>
                  <select id='lm-label-size' value={labelId()} onChange={e => setLabelId(e.currentTarget.value)}>
                    <For each={currentPrinter().labels}>{l => <option value={l.id}>{l.name}</option>}</For>
                  </select>
                </div>
              }
            >
              <div class='lm-field'>
                <span class='lm-field-label'>Label size</span>
                <div class='lm-pair'>
                  <input
                    type='number'
                    min={10}
                    aria-label='Width in mm'
                    value={custom.wMm}
                    onInput={e => setCustom('wMm', Number(e.currentTarget.value))}
                  />
                  <span aria-hidden='true'>×</span>
                  <input
                    type='number'
                    min={10}
                    aria-label='Height in mm'
                    value={custom.hMm}
                    onInput={e => setCustom('hMm', Number(e.currentTarget.value))}
                  />
                  <span aria-hidden='true'>mm @</span>
                  <input
                    type='number'
                    min={72}
                    aria-label='Dots per inch'
                    value={custom.dpi}
                    onInput={e => setCustom('dpi', Number(e.currentTarget.value))}
                  />
                  <span aria-hidden='true'>dpi</span>
                </div>
              </div>
            </Show>
            <p class='lm-note'>
              Thermal printers lay down pure black or nothing, so the label dithers sprite shading into a dot pattern.
            </p>
          </section>
        </div>
      </Show>
    </div>
  );
}
