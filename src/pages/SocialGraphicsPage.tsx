import {
  buildRenderModel,
  exportFileName,
  type Mode,
  needsDay2Stats,
  type RenderItem,
  shortTournament,
  splitPartner,
  thumbUrl
} from './socialGraphics/model';
import { baselineTournaments } from './socialGraphics/baseline';
import { type EventField, fetchEventField } from './socialGraphics/eventField';
import { type FitBounds, fitText } from './socialGraphics/fitText';
import { exportCanvas } from './socialGraphics/exportCanvas';
import { createEffect, createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import {
  fetchConversionIndex,
  fetchDay2CardStats,
  fetchEvolutionMap,
  fetchMaster,
  fetchTournamentsList,
  prettyTournamentName
} from '../lib/data';
import { ONLINE_META_NAME } from '../lib/constants';
import { Segmented } from '@ciphermaniac/design/components/Segmented';
import { Skeleton } from '@ciphermaniac/design/components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { latestValue } from '../lib/resource';
import '../styles/pages/social-graphics.css';

type Size = 8 | 12 | 20;
type Theme = 'light' | 'dark';
type MinDecks = 5 | 10 | 25;

const MODE_OPTIONS: { value: Mode; label: string }[] = [
  { value: 'standard', label: 'Standard' },
  { value: 'rising', label: 'Rising' },
  { value: 'converting', label: 'Converting' }
];
const SIZE_OPTIONS: { value: string; label: string }[] = [
  { value: '8', label: 'Top 8' },
  { value: '12', label: 'Top 12' },
  { value: '20', label: 'Top 20' }
];
const MIN_DECKS_OPTIONS: { value: string; label: string }[] = [
  { value: '5', label: 'Min 5' },
  { value: '10', label: 'Min 10' },
  { value: '25', label: 'Min 25' }
];
const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' }
];

/**
 * Shrink-to-fit bounds per name slot. `max` is the design size; long names
 * scale down toward `min` instead of overflowing the card or ellipsizing.
 */
const NAME_FIT: Record<'hero' | 'row' | 'cell' | 'tail', FitBounds> = {
  hero: { max: 42, min: 24 },
  row: { max: 22, min: 15 },
  cell: { max: 20, min: 14 },
  tail: { max: 22, min: 15 }
};

/** The two-part headline per mode; the second half renders in the accent. */
const TITLES: Record<Mode, { lead: string; accent: string }> = {
  standard: { lead: 'MOST', accent: 'PLAYED' },
  rising: { lead: 'RISING', accent: 'CARDS' },
  converting: { lead: 'BEST', accent: 'CONVERTERS' }
};

/** The headline is one line too, and shrinks to fit the column. */
const TITLE_FIT: FitBounds = { max: 64, min: 44 };

/** Why the canvas is empty, in the terms of the mode the user picked. */
function emptyNote(mode: Mode): string {
  if (mode === 'converting') {
    return 'No Day 2 data for this tournament (or no cards clear the min-decks filter).';
  }
  return 'No data yet for this selection.';
}

export function SocialGraphicsPage() {
  const [tournaments] = createResource(fetchTournamentsList);
  // Non-suspending reads (see lib/resource.ts). All selector-keyed, so keep
  // the previous canvas while a new selection refetches.
  const tournamentsData = () => latestValue(tournaments);
  const [tournament, setTournament] = createSignal<string>(ONLINE_META_NAME);
  const [mode, setMode] = createSignal<Mode>('standard');
  const [size, setSize] = createSignal<Size>(20);
  const [theme, setTheme] = createSignal<Theme>('light');
  const [minDecks, setMinDecks] = createSignal<MinDecks>(10);
  const [busy, setBusy] = createSignal<null | 'png' | 'jpg'>(null);
  const [error, setError] = createSignal<string | null>(null);

  // The PNG/JPG export rasterizes the canvas through an SVG <foreignObject>
  // (via modern-screenshot). Firefox serializes that clone differently than
  // Chromium — it drops the #1 hero's "In X of Y decks" subtitle and misrenders
  // the hero image. The bug is Firefox-specific and not worth fighting for an
  // internal tool, so we just steer Firefox users to a Chromium-based browser.
  const isFirefox = typeof navigator !== 'undefined' && /firefox/i.test(navigator.userAgent);

  // Internal desktop export tool with a fixed 1280px canvas — on phones we
  // show an honest "built for desktop" note instead of a broken horizontal
  // scroll (P2.4, decided in the mobile plan review).
  const narrowQuery = typeof window !== 'undefined' ? window.matchMedia('(max-width: 899px)') : null;
  const [isNarrow, setIsNarrow] = createSignal(narrowQuery?.matches ?? false);
  onMount(() => {
    const onChange = (e: MediaQueryListEvent) => setIsNarrow(e.matches);
    narrowQuery?.addEventListener('change', onChange);
    onCleanup(() => narrowQuery?.removeEventListener('change', onChange));
  });

  // Converting reads a Day 1 → Day 2 cut, which the rolling Online Meta
  // doesn't have. Auto-revert to Standard whenever the user lands on Online
  // Meta with it chosen.
  createEffect(() => {
    if (needsDay2Stats(mode()) && tournament() === ONLINE_META_NAME) {
      setMode('standard');
    }
  });

  onMount(() => {
    document.title = 'Social Graphics — Tools — Ciphermaniac';
  });

  // Rising measures against the last few event weekends before the selected
  // tournament, pooled; the keys are joined so the resource refetches only
  // when the set of events actually changes.
  const baselineKeys = createMemo(() => baselineTournaments(tournamentsData() ?? [], tournament()));
  const fetchBaseline = async (joined: string): Promise<EventField[]> => {
    const fields = await Promise.all(joined.split('\n').map(fetchEventField));
    return fields.filter((f): f is EventField => f !== null);
  };

  const [master] = createResource(tournament, fetchMaster);
  const [baseline] = createResource(
    () => (mode() === 'rising' && baselineKeys().length ? baselineKeys().join('\n') : null),
    fetchBaseline
  );
  const [day2Stats] = createResource(
    () => (needsDay2Stats(mode()) && tournament() !== ONLINE_META_NAME ? tournament() : null),
    key => (key ? fetchDay2CardStats(key) : Promise.resolve(null))
  );
  // The event's overall Day 2 rate, so a card's conversion can be read against
  // the field instead of in a vacuum. Same file the day-2 stats come from, so
  // the client's dedupe cache serves it rather than fetching twice.
  const [conversionIndex] = createResource(
    () => (needsDay2Stats(mode()) && tournament() !== ONLINE_META_NAME ? tournament() : null),
    key => (key ? fetchConversionIndex(key) : Promise.resolve(null))
  );
  const [evolutionMap] = createResource(fetchEvolutionMap);
  const fieldConversion = () => {
    const payload = latestValue(conversionIndex);
    return payload && payload.day1Total > 0 ? (payload.day2Total / payload.day1Total) * 100 : null;
  };
  const masterData = () => latestValue(master);
  const baselineData = () => latestValue(baseline);
  const day2StatsData = () => latestValue(day2Stats);
  const evolutionMapData = () => latestValue(evolutionMap);

  const items = createMemo<RenderItem[]>(() =>
    buildRenderModel({
      mode: mode(),
      size: size(),
      minDecks: minDecks(),
      items: masterData()?.items ?? null,
      baseline: baselineData() ?? null,
      day2Stats: day2StatsData(),
      evolutionMap: evolutionMapData()
    })
  );

  // Whether anything the ACTIVE mode reads is still loading: rising's baseline
  // events, converting's Day-2 stats.
  const loading = () =>
    master.loading || (mode() === 'rising' && baseline.loading) || (needsDay2Stats(mode()) && day2Stats.loading);

  // Export rasterizes the live preview canvas, so it must stay disabled until
  // everything above has resolved and there's a rendered canvas to snapshot
  // (items present). Gating only on `master.loading` let a click during a
  // mode's secondary load hit "Canvas not ready."
  const exportBlocked = createMemo(() => busy() !== null || items().length === 0 || loading());
  const exportLabel = (format: 'png' | 'jpg') => (busy() === format ? 'Exporting…' : `Export ${format.toUpperCase()}`);
  const deckTotal = (payload: { deckTotal: number } | null | undefined) => payload?.deckTotal ?? 0;

  async function exportImage(format: 'png' | 'jpg') {
    setBusy(format);
    setError(null);
    const name = exportFileName({ tournament: tournament(), mode: mode(), size: size(), theme: theme() }, format);
    await exportCanvas(format, name).catch((err: unknown) => {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Export failed');
    });
    setBusy(null);
  }

  return (
    <div class='sg-page'>
      <section class='hero'>
        <h1>Social Graphics</h1>
        <div class='hero-meta'>
          <span>Build a shareable top-cards graphic from any tournament report</span>
        </div>
      </section>

      <Show
        when={!isNarrow()}
        fallback={
          <div class='sg-warning' role='note'>
            <strong>This tool is built for desktop.</strong>
            <span>
              Social Graphics composes a fixed 1280px export canvas for sharing on social media — it needs a larger
              screen to be usable. Open this page on a desktop browser to build and export a graphic.
            </span>
          </div>
        }
      >
        <Show when={isFirefox}>
          <div class='sg-warning' role='alert'>
            <strong>Heads up — exports misrender in Firefox.</strong>
            <span>
              The PNG/JPG export drops the #1 card&apos;s deck-count line and warps the hero image in Firefox, because
              of how it rasterizes the graphic. Open this page in a Chromium-based browser (Chrome, Edge, Helium, Brave)
              to export cleanly.
            </span>
          </div>
        </Show>

        <div class='sg-controls'>
          <div class='sg-row'>
            <label>
              Tournament
              <select value={tournament()} onChange={e => setTournament(e.currentTarget.value)}>
                <For each={tournamentsData() ?? [ONLINE_META_NAME]}>
                  {t => <option value={t}>{prettyTournamentName(t)}</option>}
                </For>
              </select>
            </label>

            <Show when={mode() === 'rising'}>
              <span class='sg-status'>
                Compared against {baselineKeys().map(shortTournament).join(', ') || 'no recent events'}
              </span>
            </Show>
          </div>

          <div class='sg-row'>
            <label>
              Mode
              <Segmented<Mode>
                options={
                  tournament() === ONLINE_META_NAME ? MODE_OPTIONS.filter(o => !needsDay2Stats(o.value)) : MODE_OPTIONS
                }
                selected={mode()}
                onSelect={setMode}
                ariaLabel='Display mode'
              />
            </label>
            <label>
              Size
              <Segmented
                options={SIZE_OPTIONS}
                selected={String(size())}
                onSelect={v => setSize(Number(v) as Size)}
                ariaLabel='Layout size'
              />
            </label>
            <Show when={mode() === 'converting'}>
              <label>
                Min decks
                <Segmented
                  options={MIN_DECKS_OPTIONS}
                  selected={String(minDecks())}
                  onSelect={v => setMinDecks(Number(v) as MinDecks)}
                  ariaLabel='Minimum Day 1 deck count'
                />
              </label>
            </Show>
            <label>
              Theme
              <Segmented<Theme> options={THEME_OPTIONS} selected={theme()} onSelect={setTheme} ariaLabel='Theme' />
            </label>
          </div>

          <div class='sg-actions'>
            <button
              class='sg-btn primary'
              type='button'
              disabled={exportBlocked()}
              onClick={() => void exportImage('png')}
            >
              {exportLabel('png')}
            </button>
            <button class='sg-btn' type='button' disabled={exportBlocked()} onClick={() => void exportImage('jpg')}>
              {exportLabel('jpg')}
            </button>
            <Show when={error()}>
              <span class='sg-status error'>{error()}</span>
            </Show>
          </div>
        </div>

        <div class='sg-stage'>
          <Show
            when={!master.loading && items().length > 0}
            fallback={
              <Show when={loading()} fallback={<EmptyState title={emptyNote(mode())} />}>
                <Skeleton height='540px' />
              </Show>
            }
          >
            <SocialCanvas
              theme={theme()}
              mode={mode()}
              tournamentLabel={shortTournament(tournament())}
              deckTotal={deckTotal(masterData())}
              items={items()}
              minDecks={minDecks()}
              fieldConversion={fieldConversion()}
            />
          </Show>
        </div>
      </Show>
    </div>
  );
}

interface CanvasProps {
  theme: Theme;
  mode: Mode;
  tournamentLabel: string;
  deckTotal: number;
  items: RenderItem[];
  minDecks: number;
  /** The event's overall Day 1 to Day 2 rate, when it is known. */
  fieldConversion: number | null;
}

function SocialCanvas(props: CanvasProps) {
  const hero = () => props.items[0];
  // Tracked separately so the hero's shrink-to-fit recomputes when the #1 card
  // changes; the other slots remount with their row.
  const heroName = createMemo(() => hero()?.name ?? '');
  const stack = () => props.items.slice(1, 4);
  const grid = () => props.items.slice(4, 12);
  const tail = () => props.items.slice(12, 20);

  const title = () => TITLES[props.mode];
  const titleText = createMemo(() => `${title().lead} ${title().accent}`);

  function pctLabel(c: RenderItem): string {
    if (props.mode === 'rising' && c.delta !== undefined) {
      return `+${c.delta.toFixed(1)}`;
    }
    if (needsDay2Stats(props.mode)) {
      return `${Math.round(c.pct)}%`;
    }
    return `${c.pct.toFixed(1)}%`;
  }

  /** The line under a stack row's name — whatever context its mode needs. */
  function rowDecks(c: RenderItem): string {
    if (props.mode === 'rising' && c.delta !== undefined) {
      return `${c.pct.toFixed(1)}% (+${c.delta.toFixed(1)} pts)`;
    }
    if (props.mode === 'converting') {
      return `${c.day2Count?.toLocaleString()} / ${c.day1Count?.toLocaleString()} to Day 2`;
    }
    return `${c.found.toLocaleString()} / ${c.total.toLocaleString()} decks`;
  }

  /** The field's own conversion rate, the yardstick every row is read against. */
  function fieldNote(): string {
    const field = props.fieldConversion;
    return field === null ? '' : `, field ${Math.round(field)}%`;
  }

  /** How the footer describes the ranking. */
  function footNote(): string {
    if (props.mode === 'rising') {
      return 'biggest gain';
    }
    if (props.mode === 'converting') {
      return `Day 1 → Day 2 conversion (min ${props.minDecks} decks${fieldNote()})`;
    }
    return 'inclusion rate';
  }

  // Element-only children (no bare text nodes) so DOM-to-image export can't drop
  // text segments — the loose "In … of … decks" text nodes were vanishing in some
  // export environments while element children survived.
  function heroDecks() {
    const h = hero()!;
    if (props.mode === 'converting') {
      return (
        <>
          <strong>{h.day2Count?.toLocaleString()}</strong>
          <span> of </span>
          <strong>{h.day1Count?.toLocaleString()}</strong>
          <span> decks made Day 2</span>
        </>
      );
    }
    if (props.mode === 'rising' && h.delta !== undefined) {
      return (
        <>
          <span>Now in </span>
          <strong>{h.pct.toFixed(1)}%</strong>
          <span> of decks</span>
        </>
      );
    }
    return (
      <>
        <span>In </span>
        <strong>{h.found.toLocaleString()}</strong>
        <span> of </span>
        <strong>{h.total.toLocaleString()}</strong>
        <span> decks</span>
      </>
    );
  }

  return (
    <div id='sg-canvas' class='sg-canvas' data-mode={props.theme}>
      <div class='sg-head'>
        <div class='sg-mark'>
          <img src='/logo.svg' alt='' width='24' height='28' />
          Ciphermaniac
        </div>
        <div class='sg-tournament'>
          <strong>{props.tournamentLabel}</strong>
        </div>
        <div class='sg-meta'>
          <strong>{props.deckTotal.toLocaleString()} decks</strong>
        </div>
      </div>

      <Show when={hero()}>
        <div class='sg-feature'>
          <div class='sg-hero'>
            <div class='sg-hero-img' data-cat={hero()!.cat}>
              <CanvasImg item={hero()!} />
            </div>
            <div class='sg-hero-body'>
              <div>
                <h2 class='sg-hero-name' ref={el => fitText(el, heroName, NAME_FIT.hero)}>
                  {hero()!.name}
                </h2>
                <div class='sg-hero-decks'>{heroDecks()}</div>
              </div>
              <div>
                <div class='sg-hero-pct'>{pctLabel(hero()!)}</div>
                <Show when={props.mode === 'rising'}>
                  <div class='sg-hero-delta'>pts gained</div>
                </Show>
                <Show when={needsDay2Stats(props.mode)}>
                  <div class='sg-hero-delta'>to Day 2</div>
                </Show>
              </div>
            </div>
          </div>

          <div class='sg-right'>
            <h1 class='sg-title' ref={el => fitText(el, titleText, TITLE_FIT)}>
              {title().lead} <span class='accent'>{title().accent}</span>
            </h1>
            <div class='sg-stack'>
              <For each={stack()}>
                {c => (
                  <div class='sg-row-card'>
                    <div class='sg-row-img' data-cat={c.cat}>
                      <CanvasImg item={c} />
                    </div>
                    <div class='sg-row-meta'>
                      <div class='sg-row-name' ref={el => fitText(el, () => c.name, NAME_FIT.row)}>
                        {c.name}
                      </div>
                      <div class='sg-row-decks'>{rowDecks(c)}</div>
                    </div>
                    <div class='sg-row-pct'>{pctLabel(c)}</div>
                  </div>
                )}
              </For>
            </div>
          </div>
        </div>
      </Show>

      <Show when={grid().length > 0}>
        {/* A short list would otherwise leave a half-empty row of cells;
            spread them across the width instead. */}
        <div class='sg-grid' style={{ 'grid-template-columns': `repeat(${Math.min(4, grid().length)}, 1fr)` }}>
          <For each={grid()}>
            {c => (
              <div class='sg-cell'>
                <div class='sg-cell-img' data-cat={c.cat}>
                  <CanvasImg item={c} />
                </div>
                <div class='sg-cell-body'>
                  <div class='sg-cell-name' ref={el => fitText(el, () => c.name, NAME_FIT.cell)}>
                    {c.name}
                  </div>
                  <div class='sg-cell-pct'>{pctLabel(c)}</div>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={tail().length > 0}>
        <div
          class='sg-tail'
          style={{
            'grid-template-columns': `repeat(${Math.min(2, tail().length)}, minmax(0, 1fr))`,
            'grid-template-rows': `repeat(${Math.ceil(tail().length / 2)}, auto)`
          }}
        >
          <For each={tail()}>
            {c => (
              <div class='sg-tail-cell'>
                <div class='sg-tail-name' ref={el => fitText(el, () => c.name, NAME_FIT.tail)}>
                  {c.name}
                </div>
                <div class='sg-tail-pct'>{pctLabel(c)}</div>
              </div>
            )}
          </For>
        </div>
      </Show>

      <div class='sg-foot'>
        <span>
          <b>Top {props.items.length}</b> by {footNote()}
        </span>
        <span class='src'>ciphermaniac.com</span>
      </div>
    </div>
  );
}

/** A card's art, or both prints side by side for a card printed across two. */
function CanvasImg(props: { item: RenderItem }) {
  const partner = () => splitPartner(props.item.set, props.item.number);
  return (
    <Show when={partner()} fallback={<CardImg item={props.item} />}>
      {other => (
        <div class='sg-split'>
          <CardImg item={props.item} />
          <CardImg item={{ ...props.item, number: other() }} />
        </div>
      )}
    </Show>
  );
}

function CardImg(props: { item: RenderItem }) {
  const [errored, setErrored] = createSignal(false);
  return (
    <Show
      when={!errored() && props.item.set && props.item.number}
      fallback={<div class='sg-img-placeholder'>{props.item.set || '—'}</div>}
    >
      <img
        src={thumbUrl(props.item.set, props.item.number)}
        alt={props.item.name}
        crossorigin='anonymous'
        referrerpolicy='no-referrer'
        onError={() => setErrored(true)}
      />
    </Show>
  );
}
