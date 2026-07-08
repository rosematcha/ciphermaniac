import { createMemo, createResource, createSignal, For, onMount, Show } from 'solid-js';
import { A, useSearchParams } from '@solidjs/router';
import { Tabs } from '../components/Tabs';
import { Skeleton } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { resolved } from '../lib/resource';
import { cardSupercategory } from '../lib/cardStats';
import '../styles/pages/in-loving-memory.css';

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

// Toy data is uploaded to R2 (scripts/upload-toys.ts); Pages never serves
// /toys/* in production — the SPA fallback would answer with HTML and a 200.
// In dev, vite serves the scraper's output from static/ at the root.
const DATA_BASE = import.meta.env?.DEV
  ? '/toys/in-loving-memory/data'
  : 'https://r2.ciphermaniac.com/toys/in-loving-memory/data';
const THUMBNAILS_PROXY = '/thumbnails';

/**
 * Same-origin card-art proxy URL, mirroring CardImage.tsx — never hotlink the
 * Limitless CDN (its `__cf_bm` bot cookie is browser-rejected → 403s).
 */
function cardImgUrl(set?: string, number?: string): string {
  if (!set || !number) {
    return '';
  }
  const setU = set.toUpperCase();
  const parts = number.match(/^(\d+)([A-Za-z]*)$/);
  const padded = parts ? `${parts[1].padStart(3, '0')}${parts[2] ?? ''}` : number;
  return `${THUMBNAILS_PROXY}/sm/${setU}/${padded}`;
}

async function fetchIndex(): Promise<ArchetypeIndex> {
  const res = await fetch(`${DATA_BASE}/index.json`);
  if (!res.ok) {
    throw new Error(`Failed to load archetype index: ${res.status}`);
  }
  return res.json();
}

async function fetchMaster(slug: string): Promise<MasterPayload> {
  const res = await fetch(`${DATA_BASE}/${encodeURIComponent(slug)}/master.json`);
  if (!res.ok) {
    throw new Error(`Failed to load ${slug}: ${res.status}`);
  }
  return res.json();
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

  onMount(() => {
    document.title = 'In Loving Memory — Toys — Ciphermaniac';
  });

  const slug = () => (typeof searchParams.a === 'string' ? searchParams.a : '');

  // Auto-pick first archetype once index loads (if none selected).
  const effectiveSlug = createMemo(() => {
    const s = slug();
    if (s) {
      return s;
    }
    const list = indexData()?.archetypes;
    return list && list.length > 0 ? list[0].slug : '';
  });

  const [master] = createResource(effectiveSlug, s => (s ? fetchMaster(s) : Promise.resolve(null)));
  // Archetype-keyed: show the loading grid on switch, not the previous
  // archetype's cards.
  const masterData = () => resolved(master);

  function pickArchetype(s: string) {
    setSearchParams({ a: s });
    setCategory('all');
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
      <section class='hero'>
        <div class='breadcrumb'>
          <A href='/toys'>Toys</A>
          <span> / </span>
          <span class='current'>In Loving Memory</span>
        </div>
        <h1>In Loving Memory</h1>
        <div class='hero-meta'>
          <span>Every Day-2 decklist from rotated archetypes, frozen at the end of their run</span>
        </div>
      </section>

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
                      <img src={cardImgUrl(thumbSet, thumbNum)} alt={a.name} loading='lazy' />
                    </Show>
                  </div>
                  <div>
                    <div class='ilm-arche-name'>{a.name}</div>
                    <div class='ilm-arche-count'>{a.listCount.toLocaleString()} lists</div>
                  </div>
                </button>
              );
            }}
          </For>
        </div>
      </Show>

      <Show when={currentEntry()}>
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

      <Show when={masterData() && masterData()!.items.length > 0} fallback={<MasterLoading />}>
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
      <For each={Array.from({ length: 12 })}>{() => <Skeleton height='240px' />}</For>
    </div>
  );
}

function Card(props: { item: MasterItem }) {
  const url = createMemo(() => cardImgUrl(props.item.set, props.item.number));
  const [errored, setErrored] = createSignal(false);
  return (
    <div class='ilm-card'>
      <div class='ilm-card-img'>
        <Show
          when={url() && !errored()}
          fallback={
            <div class='ph'>
              {props.item.set ?? '—'}/{props.item.number ?? '—'}
            </div>
          }
        >
          <img src={url()} alt={props.item.name} loading='lazy' onError={() => setErrored(true)} />
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
