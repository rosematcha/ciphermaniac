import { createEffect, createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { A } from '@solidjs/router';
import {
  fetchDay2CardStats,
  fetchEvolutionMap,
  fetchMaster,
  fetchTournamentsList,
  prettyTournamentName
} from '../lib/data';
import type { CardItem } from '../types';
import { ONLINE_META_LABEL, ONLINE_META_NAME } from '../lib/constants';
import { Segmented } from '../components/Segmented';
import { Skeleton } from '../components/Skeleton';
import { interEmbedCss } from '../utils/fontEmbed';
import '../styles/pages/social-graphics.css';

type Mode = 'standard' | 'rising' | 'converting';
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
  { value: 'light', label: 'Cream' },
  { value: 'dark', label: 'Dark' }
];

type CatKind = 'pokemon' | 'trainer' | 'energy-basic' | 'energy-special';

interface RenderItem {
  rank: number;
  name: string;
  set: string;
  number: string;
  found: number;
  total: number;
  pct: number;
  cat: CatKind;
  /** Rising mode only: percentage-point delta vs comparison */
  delta?: number;
  /** Converting mode only: Day 1 → Day 2 conversion (0..100) */
  conversion?: number;
  /** Converting mode only: count of Day 2 decks playing this card */
  day2Count?: number;
  /** Converting mode only: count of all Day 1 decks playing this card */
  day1Count?: number;
}

function classify(item: CardItem): CatKind {
  const cat = (item.category ?? '').toLowerCase();
  const supertype = (item.supertype ?? '').toLowerCase();
  if (cat.startsWith('trainer') || supertype === 'trainer') {
    return 'trainer';
  }
  if (cat.startsWith('energy') || supertype === 'energy') {
    if (cat.includes('basic') || item.energyType === 'basic') {
      return 'energy-basic';
    }
    return 'energy-special';
  }
  return 'pokemon';
}

function thumbUrl(set: string, number: string | number): string {
  const setU = String(set).toUpperCase();
  const numStr = String(number);
  return `/thumbnails/lg/${setU}/${numStr}`;
}

function isBasicEnergy(item: CardItem): boolean {
  return item.set === 'SVE';
}

/**
 * Drop pre-evolutions whose evolved form ranks alongside them with comparable
 * stats — e.g. Rellor (37%) and Rabsca (35%) collapse to just Rabsca, since
 * the only reason a deck plays Rellor is to evolve into Rabsca. Items without
 * a sibling evolution in the list, or with stats too far apart to count as
 * "the same slot", are kept as-is.
 */
function collapseEvolutions(items: RenderItem[], evoMap: Map<string, string> | undefined, mode: Mode): RenderItem[] {
  if (!evoMap || evoMap.size === 0 || items.length === 0) {
    return items;
  }
  // Index items by lowercase name so we can find a pre-evo by parent-name lookup.
  // Multiple printings of the same Pokémon get deduped to the first (highest-ranked) entry.
  const byName = new Map<string, RenderItem>();
  for (const it of items) {
    const key = it.name.toLowerCase();
    if (!byName.has(key)) {
      byName.set(key, it);
    }
  }
  const drop = new Set<RenderItem>();
  for (const evo of items) {
    if (drop.has(evo)) {
      continue;
    }
    const parent = evoMap.get(`${evo.set}::${evo.number}`);
    if (!parent) {
      continue;
    }
    const preEvo = byName.get(parent);
    if (!preEvo || preEvo === evo || drop.has(preEvo)) {
      continue;
    }
    if (statsAreClose(preEvo, evo, mode)) {
      drop.add(preEvo);
    }
  }
  return items.filter(it => !drop.has(it));
}

function statsAreClose(preEvo: RenderItem, evo: RenderItem, mode: Mode): boolean {
  // In rising mode the deltas are what matter; in every other mode the visible
  // headline number is `pct` (which holds the conversion rate in converting mode).
  if (mode === 'rising' && preEvo.delta !== undefined && evo.delta !== undefined) {
    return Math.abs(preEvo.delta - evo.delta) <= 2;
  }
  return Math.abs(preEvo.pct - evo.pct) <= 5;
}

function shortTournament(key: string): string {
  if (key === ONLINE_META_NAME) {
    return ONLINE_META_LABEL;
  }
  const m = key.match(/^\d{4}-\d{2}-\d{2},\s*(.+)$/);
  return m ? m[1] : key;
}

export function SocialGraphicsPage() {
  const [tournaments] = createResource(fetchTournamentsList);
  const [tournament, setTournament] = createSignal<string>(ONLINE_META_NAME);
  const [comparison, setComparison] = createSignal<string>('');
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

  // The Day 1 → Day 2 cut only exists for individual tournaments, so the
  // Converting mode is meaningless against the rolling Online Meta window.
  // Auto-revert to Standard whenever the user lands on Online Meta with
  // Converting selected.
  createEffect(() => {
    if (mode() === 'converting' && tournament() === ONLINE_META_NAME) {
      setMode('standard');
    }
  });

  onMount(() => {
    document.title = 'Social Graphics — Toys — Ciphermaniac';
  });

  // Auto-default the comparison tournament to the next-most-recent regional/IC
  // once tournaments are loaded — only relevant in rising mode.
  const defaultComparison = createMemo(() => {
    const list = tournaments();
    if (!list || list.length < 2) {
      return '';
    }
    const cur = tournament();
    const idx = list.indexOf(cur);
    // List is recency-sorted, so the next one is the prior tournament.
    if (idx >= 0 && idx < list.length - 1) {
      return list[idx + 1];
    }
    return list.find(t => t !== cur) ?? '';
  });

  const effectiveComparison = createMemo(() => comparison() || defaultComparison());

  const [master] = createResource(tournament, fetchMaster);
  const [comparisonMaster] = createResource(
    () => (mode() === 'rising' ? effectiveComparison() : null),
    key => (key ? fetchMaster(key) : Promise.resolve(null))
  );
  const [day2Stats] = createResource(
    () => (mode() === 'converting' && tournament() !== ONLINE_META_NAME ? tournament() : null),
    key => (key ? fetchDay2CardStats(key) : Promise.resolve(null))
  );
  const [evolutionMap] = createResource(fetchEvolutionMap);

  const items = createMemo<RenderItem[]>(() => {
    const m = master();
    if (!m) {
      return [];
    }
    const filtered = m.items.filter(i => !isBasicEnergy(i));
    // Overcollect so evolution collapsing can still hit the requested size after
    // a few pre-evos are dropped from the candidate pool.
    const pool = size() + 8;

    let candidates: RenderItem[];

    if (mode() === 'converting') {
      const stats = day2Stats();
      if (!stats) {
        return [];
      }
      const catByUid = new Map<string, CatKind>();
      for (const it of filtered) {
        if (it.uid) {
          catByUid.set(it.uid, classify(it));
        }
      }
      const min = minDecks();
      const ranked = stats
        .filter(s => s.day1Count >= min && !(s.set === 'SVE'))
        .sort((a, b) => {
          if (b.conversion !== a.conversion) {
            return b.conversion - a.conversion;
          }
          // Tie-break on sample size so a higher-confidence row wins.
          return b.day1Count - a.day1Count;
        });
      candidates = ranked.slice(0, pool).map(s => ({
        rank: 0,
        name: s.name,
        set: s.set,
        number: s.number,
        found: s.day2Count,
        total: s.day1Count,
        pct: s.conversion,
        cat: catByUid.get(s.uid) ?? 'pokemon',
        conversion: s.conversion,
        day1Count: s.day1Count,
        day2Count: s.day2Count
      }));
    } else if (mode() === 'rising') {
      const cmp = comparisonMaster();
      if (!cmp) {
        return [];
      }
      const cmpPct = new Map<string, number>();
      for (const it of cmp.items) {
        if (it.uid) {
          cmpPct.set(it.uid, it.pct);
        }
      }
      const rising = filtered
        .filter(it => it.uid && cmpPct.has(it.uid))
        .map(it => ({ item: it, delta: it.pct - (cmpPct.get(it.uid as string) ?? 0) }))
        .filter(x => x.delta > 0)
        .sort((a, b) => b.delta - a.delta);
      candidates = rising.slice(0, pool).map(x => ({
        rank: 0,
        name: x.item.name,
        set: x.item.set ?? '',
        number: String(x.item.number ?? ''),
        found: x.item.found,
        total: x.item.total,
        pct: x.item.pct,
        cat: classify(x.item),
        delta: x.delta
      }));
    } else {
      candidates = filtered.slice(0, pool).map(it => ({
        rank: 0,
        name: it.name,
        set: it.set ?? '',
        number: String(it.number ?? ''),
        found: it.found,
        total: it.total,
        pct: it.pct,
        cat: classify(it)
      }));
    }

    const collapsed = collapseEvolutions(candidates, evolutionMap(), mode());
    return collapsed.slice(0, size()).map((c, idx) => ({ ...c, rank: idx + 1 }));
  });

  async function exportImage(format: 'png' | 'jpg') {
    setBusy(format);
    setError(null);
    const node = document.getElementById('sg-canvas') as HTMLElement | null;
    if (!node) {
      setError('Canvas not ready.');
      setBusy(null);
      return;
    }
    try {
      // Wait for any in-flight images on the canvas before snapshotting,
      // otherwise modern-screenshot can race a half-decoded thumbnail.
      const imgs = Array.from(node.querySelectorAll('img'));
      await Promise.all(
        imgs.map(img =>
          img.complete && img.naturalWidth > 0
            ? Promise.resolve()
            : new Promise<void>(resolve => {
                img.addEventListener('load', () => resolve(), { once: true });
                img.addEventListener('error', () => resolve(), { once: true });
              })
        )
      );
      const [{ domToPng, domToJpeg }, fontCssText] = await Promise.all([import('modern-screenshot'), interEmbedCss()]);
      const renderer = format === 'png' ? domToPng : domToJpeg;
      const dataUrl = await renderer(node, {
        scale: 1,
        backgroundColor: theme() === 'dark' ? '#1a1816' : '#f4ecdb',
        quality: format === 'jpg' ? 0.92 : undefined,
        font: { cssText: fontCssText }
      });
      const a = document.createElement('a');
      const slug = shortTournament(tournament())
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-+|-+$)/g, '');
      a.download = `${slug}-${mode()}-top${size()}-${theme()}.${format}`;
      a.href = dataUrl;
      a.click();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div class='sg-page'>
      <section class='hero'>
        <div class='breadcrumb'>
          <A href='/toys'>Toys</A>
          <span> / </span>
          <span class='current'>Social Graphics</span>
        </div>
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
                <For each={tournaments() ?? [ONLINE_META_NAME]}>
                  {t => <option value={t}>{prettyTournamentName(t)}</option>}
                </For>
              </select>
            </label>

            <Show when={mode() === 'rising'}>
              <label>
                Compare against
                <select value={comparison()} onChange={e => setComparison(e.currentTarget.value)}>
                  <option value=''>Previous ({prettyTournamentName(defaultComparison())})</option>
                  <For each={(tournaments() ?? []).filter(t => t !== tournament())}>
                    {t => <option value={t}>{prettyTournamentName(t)}</option>}
                  </For>
                </select>
              </label>
            </Show>
          </div>

          <div class='sg-row'>
            <label>
              Mode
              <Segmented<Mode>
                options={
                  tournament() === ONLINE_META_NAME ? MODE_OPTIONS.filter(o => o.value !== 'converting') : MODE_OPTIONS
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
              disabled={busy() !== null || master.loading}
              onClick={() => exportImage('png')}
            >
              {busy() === 'png' ? 'Exporting…' : 'Export PNG'}
            </button>
            <button
              class='sg-btn'
              type='button'
              disabled={busy() !== null || master.loading}
              onClick={() => exportImage('jpg')}
            >
              {busy() === 'jpg' ? 'Exporting…' : 'Export JPG'}
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
              <Show
                when={
                  master.loading ||
                  (mode() === 'rising' && comparisonMaster.loading) ||
                  (mode() === 'converting' && day2Stats.loading)
                }
                fallback={
                  <div class='sg-stage-empty'>
                    {mode() === 'converting'
                      ? 'No Day 2 data for this tournament (or no cards clear the min-decks filter).'
                      : 'No data yet for this selection.'}
                  </div>
                }
              >
                <Skeleton height='540px' />
              </Show>
            }
          >
            <SocialCanvas
              theme={theme()}
              mode={mode()}
              tournamentLabel={shortTournament(tournament())}
              deckTotal={master()?.deckTotal ?? 0}
              items={items()}
              minDecks={minDecks()}
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
}

function SocialCanvas(props: CanvasProps) {
  const hero = () => props.items[0];
  const stack = () => props.items.slice(1, 4);
  const grid = () => props.items.slice(4, 12);
  const tail = () => props.items.slice(12, 20);

  const titleRow1 = () => {
    if (props.mode === 'rising') {
      return 'RISING';
    }
    if (props.mode === 'converting') {
      return 'BEST';
    }
    return 'MOST';
  };
  const titleRow2 = () => {
    if (props.mode === 'rising') {
      return 'CARDS';
    }
    if (props.mode === 'converting') {
      return 'CONVERTERS';
    }
    return 'PLAYED';
  };

  function pctLabel(c: RenderItem): string {
    if (props.mode === 'rising' && c.delta !== undefined) {
      return `+${c.delta.toFixed(1)}`;
    }
    if (props.mode === 'converting') {
      return `${Math.round(c.pct)}%`;
    }
    return `${c.pct}%`;
  }

  function rankStr(n: number) {
    return String(n).padStart(2, '0');
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
        <div class='sg-mark'>Ciphermaniac</div>
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
              <div class='sg-hero-numeral'>{rankStr(hero()!.rank)}</div>
            </div>
            <div class='sg-hero-body'>
              <div>
                <h2 class='sg-hero-name'>{hero()!.name}</h2>
                <div class='sg-hero-decks'>{heroDecks()}</div>
              </div>
              <div>
                <div class='sg-hero-pct'>{pctLabel(hero()!)}</div>
                <Show when={props.mode === 'rising'}>
                  <div class='sg-hero-delta'>pts gained</div>
                </Show>
                <Show when={props.mode === 'converting'}>
                  <div class='sg-hero-delta'>to Day 2</div>
                </Show>
              </div>
            </div>
          </div>

          <div class='sg-right'>
            <h1 class='sg-title'>
              {titleRow1()} <span class='accent'>{titleRow2()}</span>
            </h1>
            <div class='sg-stack'>
              <For each={stack()}>
                {c => (
                  <div class='sg-row-card'>
                    <div class='sg-row-rank'>{rankStr(c.rank)}</div>
                    <div class='sg-row-img' data-cat={c.cat}>
                      <CanvasImg item={c} />
                    </div>
                    <div class='sg-row-meta'>
                      <div class='sg-row-name'>{c.name}</div>
                      <div class='sg-row-decks'>
                        {props.mode === 'rising' && c.delta !== undefined
                          ? `${c.pct.toFixed(1)}% (+${c.delta.toFixed(1)} pts)`
                          : props.mode === 'converting'
                            ? `${c.day2Count?.toLocaleString()} / ${c.day1Count?.toLocaleString()} to Day 2`
                            : `${c.found.toLocaleString()} / ${c.total.toLocaleString()} decks`}
                      </div>
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
        <div class='sg-grid'>
          <For each={grid()}>
            {c => (
              <div class='sg-cell'>
                <div class='sg-cell-img' data-cat={c.cat}>
                  <CanvasImg item={c} />
                  <div class='sg-cell-rank'>{rankStr(c.rank)}</div>
                </div>
                <div class='sg-cell-body'>
                  <div class='sg-cell-name'>{c.name}</div>
                  <div class='sg-cell-pct'>{pctLabel(c)}</div>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={tail().length > 0}>
        <div class='sg-tail'>
          <For each={tail()}>
            {c => (
              <div class='sg-tail-cell'>
                <div class='sg-tail-rank'>№ {rankStr(c.rank)}</div>
                <div class='sg-tail-name'>{c.name}</div>
                <div class='sg-tail-pct'>{pctLabel(c)}</div>
              </div>
            )}
          </For>
        </div>
      </Show>

      <div class='sg-foot'>
        <span>
          <b>Top {props.items.length}</b> by{' '}
          {props.mode === 'rising'
            ? 'biggest gain'
            : props.mode === 'converting'
              ? `Day 1 → Day 2 conversion (min ${props.minDecks} decks)`
              : 'inclusion rate'}
        </span>
        <span class='src'>CIPHERMANIAC.COM</span>
      </div>
    </div>
  );
}

function CanvasImg(props: { item: RenderItem }) {
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
