import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { useSearchParams } from '@solidjs/router';
import { CardImage } from '../components/CardImage';
import { Tabs } from '../components/Tabs';
import { Skeleton } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { resolved } from '../lib/resource';
import { cardSupercategory } from '../lib/cardStats';
import '../styles/pages/in-loving-memory.css';
import { R2_ORIGIN } from '../lib/constants';

interface ArchetypeEntry {
  name: string;
  slug: string;
  archetypeId: number;
  listCount: number;
  /** "SET/NUMBER" identifier for thumbnail */
  thumbnail: string;
  rotations: { date: string; label?: string }[];
}

interface ArchetypeIndex {
  archetypes: ArchetypeEntry[];
}

interface DistEntry {
  copies: number;
  players: number;
  percent: number;
}

interface MasterItem {
  rank: number;
  name: string;
  found: number;
  total: number;
  pct: number;
  dist?: DistEntry[];
  set?: string;
  number?: string;
  uid?: string;
  category?: 'pokemon' | 'trainer' | 'energy' | string;
  trainerType?: string;
  energyType?: string;
  aceSpec?: boolean;
}

interface MasterPayload {
  deckTotal: number;
  archetype: string;
  archetypeId: number;
  items: MasterItem[];
}

type CategoryFilter = 'all' | 'pokemon' | 'trainer' | 'energy' | 'ace-spec';
type SortMode = 'usage-desc' | 'usage-asc' | 'name-asc' | 'name-desc';

const CATEGORY_TABS: { value: CategoryFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'pokemon', label: 'Pokémon' },
  { value: 'trainer', label: 'Trainer' },
  { value: 'energy', label: 'Energy' },
  { value: 'ace-spec', label: 'ACE SPEC' }
];

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'usage-desc', label: 'Usage (high → low)' },
  { value: 'usage-asc', label: 'Usage (low → high)' },
  { value: 'name-asc', label: 'Name (A → Z)' },
  { value: 'name-desc', label: 'Name (Z → A)' }
];

// Uploaded to R2 by scripts/upload-toys.ts. The R2 keys deliberately keep the
// original `toys/` prefix even though the section is now /tools — they're
// storage paths, not URLs, and renaming them buys nothing but a migration.
const R2_BASE = `${R2_ORIGIN}/toys/in-loving-memory/data`;
const LOCAL_BASE = '/toys/in-loving-memory/data';

/**
 * In dev, prefer a local scraper run under `static/toys/` and fall back to R2
 * when there isn't one — that directory is gitignored, so a fresh checkout has
 * no local copy and would otherwise render an empty page. Production always
 * goes straight to R2: Pages never serves these paths (the SPA fallback would
 * answer with HTML and a 200).
 */
async function fetchJson<T>(path: string): Promise<T> {
  if (import.meta.env?.DEV) {
    try {
      const local = await fetch(`${LOCAL_BASE}${path}`);
      // Vite's SPA fallback answers 200 with index.html for a missing file, so
      // "did it 200" isn't enough — check that we actually got JSON back.
      if (local.ok && local.headers.get('content-type')?.includes('json')) {
        return (await local.json()) as T;
      }
    } catch {
      /* fall through to R2 */
    }
  }
  const res = await fetch(`${R2_BASE}${path}`);
  if (!res.ok) {
    throw new Error(`Failed to load ${path}: ${res.status}`);
  }
  return (await res.json()) as T;
}

async function fetchIndex(): Promise<ArchetypeIndex> {
  return fetchJson<ArchetypeIndex>('/index.json');
}

async function fetchMaster(slug: string): Promise<MasterPayload> {
  return fetchJson<MasterPayload>(`/${encodeURIComponent(slug)}/master.json`);
}

function categoryOf(item: MasterItem): CategoryFilter {
  if (item.aceSpec) {
    return 'ace-spec';
  }
  if (!item.category) {
    return 'all';
  }
  return cardSupercategory(item);
}

export function InLovingMemoryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [index] = createResource(fetchIndex);
  // Non-suspending read (see lib/resource.ts).
  const indexData = () => resolved(index);
  const [category, setCategory] = createSignal<CategoryFilter>('all');
  const [sort, setSort] = createSignal<SortMode>('usage-desc');

  // Phones get a two-screen drill-down instead of the desktop layout's
  // picker-above-grid: the archetype list fills the screen, tapping one
  // replaces it with that archetype's cards, and a back link returns. Showing
  // both at once left a row of chips eating the viewport above every grid.
  const narrowQuery = typeof window !== 'undefined' ? window.matchMedia('(max-width: 720px)') : null;
  const [isNarrow, setIsNarrow] = createSignal(narrowQuery?.matches ?? false);
  onMount(() => {
    const onChange = (e: MediaQueryListEvent) => setIsNarrow(e.matches);
    narrowQuery?.addEventListener('change', onChange);
    onCleanup(() => narrowQuery?.removeEventListener('change', onChange));
  });

  onMount(() => {
    document.title = 'In Loving Memory — Tools — Ciphermaniac';
  });

  const slug = () => (typeof searchParams.a === 'string' ? searchParams.a : '');

  // Desktop auto-picks the first archetype so the page is never empty. Phones
  // must not: the list IS the first screen, and auto-picking would skip it and
  // fetch a master file nobody asked for.
  const effectiveSlug = createMemo(() => {
    const s = slug();
    if (s) {
      return s;
    }
    if (isNarrow()) {
      return '';
    }
    const list = indexData()?.archetypes;
    return list && list.length > 0 ? list[0].slug : '';
  });

  /** Phone, archetype chosen: show the cards, hide the list. */
  const showDetailOnly = () => isNarrow() && Boolean(effectiveSlug());
  /** Phone, nothing chosen yet: show the list, hide everything else. */
  const showListOnly = () => isNarrow() && !effectiveSlug();

  const [master] = createResource(effectiveSlug, s => (s ? fetchMaster(s) : Promise.resolve(null)));
  // Archetype-keyed: show the loading grid on switch, not the previous
  // archetype's cards.
  const masterData = () => resolved(master);

  function pickArchetype(s: string) {
    setSearchParams({ a: s });
    setCategory('all');
    // The phone drill-down swaps the whole screen, so land at the top of the
    // new one rather than wherever the list was scrolled to.
    if (isNarrow()) {
      window.scrollTo({ top: 0 });
    }
  }

  function clearArchetype() {
    setSearchParams({ a: undefined });
    setCategory('all');
    window.scrollTo({ top: 0 });
  }

  const currentEntry = createMemo(() => {
    const idx = indexData();
    if (!idx) {
      return null;
    }
    return idx.archetypes.find(a => a.slug === effectiveSlug()) ?? null;
  });

  const filteredItems = createMemo<MasterItem[]>(() => {
    const m = masterData();
    if (!m) {
      return [];
    }
    const cat = category();
    const items = cat === 'all' ? m.items : m.items.filter(i => categoryOf(i) === cat);
    const sorted = [...items];
    const mode = sort();
    sorted.sort((a, b) => {
      if (mode === 'usage-desc') {
        return b.pct - a.pct;
      }
      if (mode === 'usage-asc') {
        return a.pct - b.pct;
      }
      const cmp = a.name.localeCompare(b.name);
      return mode === 'name-asc' ? cmp : -cmp;
    });
    return sorted;
  });

  return (
    <div class='ilm-page'>
      <Show when={!showDetailOnly()}>
        <section class='hero'>
          <h1>In Loving Memory</h1>
          <div class='hero-meta'>
            <span>Every Day-2 decklist from rotated archetypes, frozen at the end of their run</span>
          </div>
        </section>
      </Show>

      <Show when={showDetailOnly()}>
        <button type='button' class='ilm-back' onClick={clearArchetype}>
          <span aria-hidden='true'>←</span> All archetypes
        </button>
      </Show>

      <Show when={!showDetailOnly()}>
        <Show when={indexData() && indexData()!.archetypes.length > 0} fallback={<Skeleton height='80px' />}>
          <div class='ilm-picker' role='radiogroup' aria-label='Pick an archetype'>
            <For each={indexData()!.archetypes}>
              {a => {
                const [thumbSet, thumbNum] = a.thumbnail.split('/');
                return (
                  <button
                    type='button'
                    role='radio'
                    class='ilm-arche'
                    aria-checked={a.slug === effectiveSlug() ? 'true' : 'false'}
                    onClick={() => pickArchetype(a.slug)}
                  >
                    <div class='ilm-arche-thumb'>
                      <Show when={a.thumbnail}>
                        <CardImage set={thumbSet} number={thumbNum} size='xs' alt='' />
                      </Show>
                    </div>
                    <div class='ilm-arche-text'>
                      <div class='ilm-arche-name'>{a.name}</div>
                      <div class='ilm-arche-count'>{a.listCount.toLocaleString()} lists</div>
                    </div>
                  </button>
                );
              }}
            </For>
          </div>
        </Show>
      </Show>

      <Show when={currentEntry() && !showListOnly()}>
        <div class='ilm-summary'>
          <div class='ilm-summary-headline'>
            <em>{currentEntry()!.name}</em> — final cut
          </div>
          <div class='ilm-summary-stat'>
            <b>{(masterData()?.deckTotal ?? currentEntry()!.listCount).toLocaleString()}</b>
            Day-2 lists
          </div>
          <div class='ilm-summary-stat'>
            <b>{masterData()?.items.length ?? '—'}</b>
            distinct cards
          </div>
          <Show when={currentEntry()!.rotations.length > 0}>
            <div class='ilm-rotations' aria-label='Rotation milestones'>
              <For each={currentEntry()!.rotations}>
                {r => (
                  <span class='ilm-rotation' title={r.label ?? r.date}>
                    {r.date}
                  </span>
                )}
              </For>
            </div>
          </Show>
        </div>
      </Show>

      <Show
        when={masterData() && masterData()!.items.length > 0}
        fallback={
          <Show when={!showListOnly()}>
            <MasterLoading />
          </Show>
        }
      >
        <div class='ilm-toolbar'>
          <Tabs<CategoryFilter>
            options={CATEGORY_TABS}
            selected={category()}
            onSelect={setCategory}
            ariaLabel='Card category'
          />
          <label class='ilm-sort'>
            Sort
            <select value={sort()} onChange={e => setSort(e.currentTarget.value as SortMode)}>
              <For each={SORT_OPTIONS}>{o => <option value={o.value}>{o.label}</option>}</For>
            </select>
          </label>
        </div>

        <Show
          when={filteredItems().length > 0}
          fallback={<EmptyState title='No cards in this category.' description='Try another tab.' />}
        >
          <div class='ilm-grid'>
            <For each={filteredItems()}>{item => <Card item={item} />}</For>
          </div>
        </Show>
      </Show>
    </div>
  );
}

function MasterLoading() {
  return (
    <div class='ilm-grid' aria-busy='true'>
      {/* Shaped like `.ilm-card`: the art box is a 2.5:3.5 aspect, so a tile's
          height follows its column width and a flat pixel value is only ever
          right at one breakpoint. */}
      <For each={Array.from({ length: 12 })}>
        {() => (
          <div class='ilm-card ilm-card-skeleton'>
            <div class='ilm-card-img' />
            <div class='ilm-card-meta'>
              <div class='ilm-card-bar' />
              <div class='ilm-card-foot'>
                <span class='ilm-card-name'>
                  <Skeleton width='70%' height='1em' />
                </span>
              </div>
            </div>
          </div>
        )}
      </For>
    </div>
  );
}

function Card(props: { item: MasterItem }) {
  return (
    <div class='ilm-card'>
      <div class='ilm-card-img'>
        {/* CardImage, not a hand-rolled /thumbnails URL. The old version built
            one proxy URL per card and latched to a permanent placeholder on the
            first onError, with no retry — and an archetype here is 110-290
            cards all requesting through the Function at once, so any transient
            failure blanked that card for the rest of the session. CardImage
            prefers the R2 WebP mirror (most cards never touch the Function at
            all) and falls back through sm → xs before giving up. */}
        <Show
          when={props.item.set && props.item.number}
          fallback={
            <div class='ph'>
              {props.item.set ?? '—'}/{props.item.number ?? '—'}
            </div>
          }
        >
          <CardImage
            set={props.item.set!}
            number={props.item.number!}
            size='sm'
            alt={props.item.name}
            sizes='(max-width: 560px) 45vw, 160px'
          />
        </Show>
      </div>
      <div class='ilm-card-meta'>
        <div class='ilm-card-bar' aria-hidden='true'>
          <span style={{ width: `${Math.min(100, props.item.pct)}%` }} />
        </div>
        <div class='ilm-card-foot'>
          <span class='ilm-card-name' title={props.item.name}>
            {props.item.name}
          </span>
          <span class='ilm-card-pct'>{props.item.pct.toFixed(1)}%</span>
        </div>
      </div>
    </div>
  );
}
