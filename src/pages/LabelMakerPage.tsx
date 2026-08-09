import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import { Segmented } from '../components/Segmented';
import { PokemonPicker, prettySlugName } from '../components/PokemonPicker';
import { defaultConfig, type LabelConfig } from '../lib/labelmaker/types';
import { renderLabel } from '../lib/labelmaker/renderLabel';
import { type LabelDims, PRINTERS } from '../lib/labelmaker/printers';
import {
  buildPrintDocument,
  describeSize,
  type LabelSizeSpec,
  loadQueue,
  type PrintJob,
  type QueuedLabel,
  queueLabelName,
  resolveDims,
  saveQueue
} from '../lib/labelmaker/queue';
import '../styles/pages/label-maker.css';

const LAYOUT_OPTIONS = [
  { value: 'keepsake' as const, label: 'Keepsake' },
  { value: 'ticket' as const, label: 'Ticket' }
];
const THIRD_ROW_OPTIONS = [
  { value: 'none' as const, label: 'None' },
  { value: 'text' as const, label: 'Text' },
  { value: 'stars' as const, label: 'Stars' }
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

/** A queued label drawn at its own geometry, scaled down by CSS to a row thumb. */
function QueueThumb(props: { item: QueuedLabel }) {
  let ref: HTMLCanvasElement | undefined;
  const dims = () => resolveDims(props.item.size);
  createEffect(() => {
    const canvas = ref;
    if (canvas) {
      void renderLabel(canvas, props.item.config, dims());
    }
  });
  return (
    <canvas
      ref={ref}
      class='lm-queue-thumb'
      width={dims().wDots}
      height={dims().hDots}
      style={{ 'aspect-ratio': `${dims().wDots} / ${dims().hDots}` }}
      aria-label={`Preview of ${queueLabelName(props.item)}`}
      role='img'
    />
  );
}

export function LabelMakerPage() {
  const [config, setConfig] = createStore<LabelConfig>({ ...defaultConfig });
  // The title auto-follows the Pokémon selection until the user types over it,
  // at which point it's theirs and we stop touching it.
  const [titleEdited, setTitleEdited] = createSignal(false);
  const [printerId, setPrinterId] = createSignal('ql800');
  const [labelId, setLabelId] = createSignal('dk1209');
  const [custom, setCustom] = createStore({ enabled: false, dpi: 300, wMm: 62, hMm: 29 });
  const [error, setError] = createSignal<string | null>(null);
  const [queue, setQueue] = createSignal<QueuedLabel[]>([]);
  // Set while the editor is standing in for a queued label rather than a new
  // one, so saving updates that row instead of appending a near-duplicate.
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [clearArmed, setClearArmed] = createSignal(false);
  let clearTimer = 0;
  onCleanup(() => window.clearTimeout(clearTimer));

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
    setQueue(loadQueue(localStorage));
  });

  const currentPrinter = () => PRINTERS.find(p => p.id === printerId()) ?? PRINTERS[0];

  const sizeSpec = (): LabelSizeSpec => ({
    printerId: printerId(),
    labelId: labelId(),
    custom: custom.enabled ? { wMm: custom.wMm, hMm: custom.hMm, dpi: custom.dpi } : null
  });

  const dims = createMemo<LabelDims>(() => resolveDims(sizeSpec()));

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

  /** Hand a finished document to a new tab and let it print itself. */
  function openPrintWindow(jobs: PrintJob[], title: string) {
    const win = window.open('', '_blank');
    if (!win) {
      setError('Your browser blocked the print window. Allow pop-ups for this site, or download the PNG instead.');
      return;
    }
    win.document.write(buildPrintDocument(jobs, title));
    win.document.close();
  }

  function print() {
    const data = snapshotPng();
    if (!data) {
      return;
    }
    openPrintWindow([{ dataUrl: data, dims: dims() }], fileSlug());
  }

  // ---------- queue ----------

  function newId(): string {
    return typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `label-${String(Date.now())}-${String(Math.round(Math.random() * 1e6))}`;
  }

  function commitQueue(next: QueuedLabel[]) {
    setQueue(next);
    saveQueue(localStorage, next);
  }

  /** Back to a blank label, keeping the printer and size you're working at. */
  function resetEditor() {
    setConfig({ ...defaultConfig });
    setTitleEdited(false);
    setEditingId(null);
  }

  function saveToQueue() {
    const entry: QueuedLabel = {
      id: editingId() ?? newId(),
      // The auto-title is what the canvas draws, so it's what gets stored —
      // otherwise a queued label re-renders blank once it leaves the editor.
      config: { ...config, title: effectiveTitle() },
      size: sizeSpec()
    };
    const current = queue();
    const at = current.findIndex(item => item.id === entry.id);
    commitQueue(at === -1 ? [...current, entry] : current.map((item, i) => (i === at ? entry : item)));
    resetEditor();
  }

  function editQueued(item: QueuedLabel) {
    setConfig({ ...item.config });
    setTitleEdited(true);
    setEditingId(item.id);
    if (item.size.custom) {
      setCustom({ enabled: true, ...item.size.custom });
    } else {
      setCustom('enabled', false);
      setPrinterId(item.size.printerId);
      setLabelId(item.size.labelId);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function removeQueued(id: string) {
    commitQueue(queue().filter(item => item.id !== id));
    if (editingId() === id) {
      resetEditor();
    }
  }

  /**
   * Two-step rather than a confirm dialog: twelve queued labels is real work to
   * lose, and the second click re-arms itself after a few seconds so a stray
   * first click doesn't leave a loaded gun on the page.
   */
  function clearQueue() {
    if (!clearArmed()) {
      setClearArmed(true);
      clearTimer = window.setTimeout(() => setClearArmed(false), 4000);
      return;
    }
    window.clearTimeout(clearTimer);
    setClearArmed(false);
    commitQueue([]);
    setEditingId(null);
  }

  /**
   * Render every queued label off-screen, then send the whole batch as one
   * print job. Rendering here rather than reusing the row thumbnails keeps the
   * output at full print resolution regardless of what the thumbnails did.
   */
  async function printQueue() {
    const items = queue();
    if (items.length === 0) {
      return;
    }
    setBusy(true);
    try {
      const jobs: PrintJob[] = [];
      for (const item of items) {
        const d = resolveDims(item.size);
        const canvas = document.createElement('canvas');
        canvas.width = d.wDots;
        canvas.height = d.hDots;
        await renderLabel(canvas, item.config, d);
        jobs.push({ dataUrl: canvas.toDataURL('image/png'), dims: d });
      }
      setError(null);
      openPrintWindow(jobs, `labels-${String(jobs.length)}`);
    } catch {
      setError('Could not render the queued labels. Reload the page and try again.');
    } finally {
      setBusy(false);
    }
  }

  const showStars = () =>
    (config.layout === 'keepsake' && config.thirdRow === 'stars') ||
    (config.layout === 'ticket' && config.stubContent === 'stars');
  // Progress is a ticket-stub idea only; the keepsake third row dropped it.
  const showProgress = () => config.layout === 'ticket' && config.stubContent !== 'stars';

  return (
    <div class='lm-page'>
      <section class='hero'>
        <h1>Deck Box Label Maker</h1>
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
        <div class='lm-shell' classList={{ 'has-queue': queue().length > 0 }}>
          <div class='lm-main'>
            <div class='lm-stage'>
              <div class='lm-stage-media'>
                <div class='lm-paper'>
                  <canvas
                    ref={canvasRef}
                    width={dims().wDots}
                    height={dims().hDots}
                    aria-label='Label preview'
                    role='img'
                  />
                </div>
              </div>
              <div class='lm-stage-foot'>
                <div class='lm-actions'>
                  <button type='button' class='btn btn-primary' onClick={saveToQueue} disabled={isEmpty()}>
                    {editingId() ? 'Save changes' : 'Add to queue'}
                  </button>
                  <Show when={editingId()}>
                    <button type='button' class='btn btn-secondary' onClick={resetEditor}>
                      Cancel edit
                    </button>
                  </Show>
                  {/* Quieter than Add to queue: printing or saving a single label
                is the exception now that the batch is the main path. */}
                  <button type='button' class='btn btn-ghost' onClick={print} disabled={isEmpty()}>
                    Print this one
                  </button>
                  <button type='button' class='btn btn-ghost' onClick={download} disabled={isEmpty()}>
                    Download PNG
                  </button>
                </div>
                <span class='lm-dims num'>
                  {dims().wDots} × {dims().hDots} dots · {dims().wMm} × {dims().hMm} mm at {dims().dpi} dpi · 1-bit
                </span>
              </div>
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
                    placeholder='Deck subtitle'
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
                  Thermal printers lay down pure black or nothing, so the label dithers sprite shading into a dot
                  pattern.
                </p>
              </section>
            </div>
          </div>

          {/* The rail only exists once there's something in it, so an empty
            queue costs no space and its arrival is the feedback for adding. */}
          <Show when={queue().length > 0}>
            <section class='lm-queue'>
              <div class='lm-queue-head'>
                <h2>
                  Print queue <span class='num'>({queue().length})</span>
                </h2>
                <div class='lm-actions'>
                  <button type='button' class='btn btn-primary' onClick={() => void printQueue()} disabled={busy()}>
                    {busy() ? 'Rendering…' : 'Print all'}
                  </button>
                  <button
                    type='button'
                    class='btn btn-secondary'
                    classList={{ 'lm-danger': clearArmed() }}
                    onClick={clearQueue}
                  >
                    {clearArmed() ? 'Click again to clear' : 'Clear queue'}
                  </button>
                </div>
              </div>

              <ul class='lm-queue-list'>
                <For each={queue()}>
                  {item => (
                    <li class='lm-queue-item' classList={{ 'is-editing': editingId() === item.id }}>
                      <QueueThumb item={item} />
                      <div class='lm-queue-meta'>
                        <span class='lm-queue-name'>{queueLabelName(item)}</span>
                        <span class='lm-queue-size num'>{describeSize(resolveDims(item.size))}</span>
                      </div>
                      <div class='lm-queue-row-actions'>
                        <button type='button' class='btn btn-ghost' onClick={() => editQueued(item)}>
                          Edit
                        </button>
                        <button type='button' class='btn btn-ghost' onClick={() => removeQueued(item.id)}>
                          Remove
                        </button>
                      </div>
                    </li>
                  )}
                </For>
              </ul>
            </section>
          </Show>
        </div>
      </Show>
    </div>
  );
}
