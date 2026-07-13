import { createMemo, createResource, createSignal, For, onMount, Show } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { fetchMaster, fetchPrices, prettyTournamentName, type PricingEntry } from '../lib/data';
import { useTournament } from '../lib/tournamentContext';
import { ONLINE_META_LABEL, ONLINE_META_NAME } from '../lib/constants';
import type { CardItem } from '../types';
import { Section } from '../components/Section';
import { ChipGroup, SearchInput } from '../components/Chip';
import { Segmented } from '../components/Segmented';
import { Pagination } from '../components/Pagination';
import { Skeleton } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { CardTile } from '../components/CardTile';
import { BottomSheet } from '../components/BottomSheet';
import { createPagination } from '../lib/pagination';
import { debounced } from '../lib/debounce';
import { latestValue } from '../lib/resource';
import { averageCopies, averageCopiesValue, categoryLabel } from '../lib/cardStats';
import { type CardFilters, countActiveCardFilters, matchesCardFilters, type PriceBand } from '../lib/cardFilters';
import {
  createPersistentNumberSignal,
  createPersistentSignal,
  createPersistentViewMode
} from '../lib/persistentSignal';
import '../styles/pages/cards.css';

type SortKey = 'rank' | 'name' | 'price' | 'inclusion' | 'avgCopies';
type SortDir = 'asc' | 'desc';
type TypeFilter = 'all' | 'pokemon' | 'trainer' | 'energy';
type ViewMode = 'grid' | 'list';
type Subtype = string; // 'all' or a trainer/energy subtype value
type RegMark = 'all' | 'G' | 'H' | 'I' | 'J';

const PAGE_SIZE = 60;

// Contextual subtype options, keyed by the parent type. Only trainers and
// energy carry a meaningful subdivision; Pokémon show no subtype group.
const SUBTYPE_OPTIONS: Record<'trainer' | 'energy', { value: string; label: string }[]> = {
  trainer: [
    { value: 'supporter', label: 'Supporter' },
    { value: 'item', label: 'Item' },
    { value: 'tool', label: 'Tool' },
    { value: 'stadium', label: 'Stadium' }
  ],
  energy: [
    { value: 'basic', label: 'Basic' },
    { value: 'special', label: 'Special' }
  ]
};

const REG_MARKS: RegMark[] = ['G', 'H', 'I', 'J'];

const PRICE_BANDS: { value: PriceBand; label: string }[] = [
  { value: 'lt1', label: 'Under $1' },
  { value: '1to5', label: '$1–5' },
  { value: '5to15', label: '$5–15' },
  { value: 'gte15', label: '$15+' }
];

// Sort options offered inside the mobile sheet — the headline three plus
// inclusion, matching the round-2 prototype's sort group.
const SHEET_SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'rank', label: 'Rank' },
  { value: 'price', label: 'Price' },
  { value: 'name', label: 'Name' },
  { value: 'inclusion', label: 'Inclusion' }
];
// The Segmented control keeps the three headline sorts; the list-view table
// headers (see ListView) drive the full set including inclusion and avg copies.
const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'rank', label: 'Rank' },
  { value: 'price', label: 'Price' },
  { value: 'name', label: 'Name' }
];

// Default sort direction when switching to a column, so each metric opens in
// the order people expect (best-first) rather than a blanket ascending.
function defaultDir(key: SortKey): SortDir {
  return key === 'rank' || key === 'name' ? 'asc' : 'desc';
}

const VIEW_OPTIONS: { value: ViewMode; label: string }[] = [
  { value: 'grid', label: 'Grid' },
  { value: 'list', label: 'List' }
];

export function CardsIndexPage() {
  const { tournament } = useTournament();
  const [master, { refetch: refetchMaster }] = createResource(tournament, fetchMaster);
  const [prices] = createResource(fetchPrices);
  const [query, setQuery] = createPersistentSignal<string>('cm:cardsQuery', '', v => v, sessionStorage);
  const [typeFilter, setTypeFilter] = createPersistentSignal<TypeFilter>(
    'cm:cardsType',
    'all',
    v => (v === 'all' || v === 'pokemon' || v === 'trainer' || v === 'energy' ? v : null),
    sessionStorage
  );
  const [sortKey, setSortKey] = createPersistentSignal<SortKey>(
    'cm:cardsSort',
    'rank',
    v => (v === 'rank' || v === 'name' || v === 'price' || v === 'inclusion' || v === 'avgCopies' ? v : null),
    sessionStorage
  );
  const [sortDir, setSortDir] = createPersistentSignal<SortDir>(
    'cm:cardsSortDir',
    'asc',
    v => (v === 'asc' || v === 'desc' ? v : null),
    sessionStorage
  );
  const [viewMode, setViewMode] = createPersistentViewMode('cm:cardsView');

  // Metadata filters (shared by the desktop bar and the mobile sheet). Each is
  // an independent persistent signal so the URL-less session state survives a
  // reload the same way the type/sort filters already do.
  const [subtype, setSubtype] = createPersistentSignal<Subtype>('cm:cardsSubtype', 'all', v => v, sessionStorage);
  const [reg, setReg] = createPersistentSignal<RegMark>(
    'cm:cardsReg',
    'all',
    v => (v === 'all' || v === 'G' || v === 'H' || v === 'I' || v === 'J' ? v : null),
    sessionStorage
  );
  const [aceSpec, setAceSpec] = createPersistentSignal<'true' | 'false'>(
    'cm:cardsAceSpec',
    'false',
    v => (v === 'true' || v === 'false' ? v : null),
    sessionStorage
  );
  const [priceBand, setPriceBand] = createPersistentSignal<'all' | PriceBand>(
    'cm:cardsPriceBand',
    'all',
    v => (v === 'all' || v === 'lt1' || v === '1to5' || v === '5to15' || v === 'gte15' ? v : null),
    sessionStorage
  );

  // Refine-surface visibility. Two independent signals because the surfaces
  // differ per breakpoint (mobile bottom sheet vs desktop in-flow panel) and
  // the sheet is portalled — one shared signal would open both at once.
  const [sheetOpen, setSheetOpen] = createSignal(false);
  const [panelOpen, setPanelOpen] = createSignal(false);

  const pageSignal = createPersistentNumberSignal('cm:cardsPage', 1, sessionStorage);
  const navigate = useNavigate();

  onMount(() => {
    document.title = 'Cards — Ciphermaniac';
  });

  const scopeLabel = () => (tournament() === ONLINE_META_NAME ? ONLINE_META_LABEL : prettyTournamentName(tournament()));

  // Non-suspending reads (see lib/resource.ts). `latestValue` keeps the old
  // table in place while a tournament switch refetches — better than a
  // skeleton flash for context-keyed data.
  const masterData = () => latestValue(master);
  const pricesData = () => latestValue(prices);

  // The input binds the raw `query` signal so typing echoes instantly; the
  // filter → sort → 60-tile render chain reads this debounced view so it runs
  // once per pause instead of once per keystroke.
  const debouncedQuery = debounced(query, 150);

  const priceFor = (item: CardItem): number | null => {
    const map = pricesData();
    if (!map) {
      return null;
    }
    if (!item.set || item.number === undefined) {
      return null;
    }
    const key = `${item.name}::${item.set}::${item.number}`;
    const entry: PricingEntry | undefined = map[key];
    const p = entry?.price;
    return typeof p === 'number' && Number.isFinite(p) ? p : null;
  };

  // Snapshot of the metadata facets in the shape the pure predicate expects.
  const cardFilters = (): CardFilters => ({
    type: typeFilter(),
    subtype: subtype(),
    reg: reg(),
    aceSpec: aceSpec() === 'true',
    priceBand: priceBand()
  });

  const activeFilterCount = () => countActiveCardFilters(cardFilters());

  const filtered = createMemo(() => {
    const items = masterData()?.items ?? [];
    const q = debouncedQuery().trim().toLowerCase();
    const filters = cardFilters();
    return items.filter(item => {
      if (!item.set || item.number === undefined) {
        return false;
      }
      if (q && !item.name.toLowerCase().includes(q)) {
        return false;
      }
      // Price is only resolved when a band filter is active — the lookup is a
      // string build + map read we'd rather skip for the common case.
      const price = filters.priceBand === 'all' ? null : priceFor(item);
      return matchesCardFilters(item, filters, price);
    });
  });

  const sorted = createMemo(() => {
    const key = sortKey();
    const mul = sortDir() === 'asc' ? 1 : -1;

    if (key === 'name') {
      return [...filtered()].sort((a, b) => mul * a.name.localeCompare(b.name));
    }

    if (key === 'price') {
      // Decorate once: `priceFor` builds a key + map lookup, so compute per item
      // rather than twice per comparison. Missing prices always sort last.
      const decorated = filtered().map(item => ({ item, price: priceFor(item), rank: item.rank ?? 9e9 }));
      decorated.sort((a, b) => {
        if (a.price === null && b.price === null) {
          return a.rank - b.rank;
        }
        if (a.price === null) {
          return 1;
        }
        if (b.price === null) {
          return -1;
        }
        return mul * (a.price - b.price);
      });
      return decorated.map(d => d.item);
    }

    // Remaining keys are plain numeric — precompute each item's sort value once
    // (avgCopies is two reduces per item) instead of recomputing per comparison.
    const valueOf = (item: CardItem): number => {
      switch (key) {
        case 'inclusion':
          return item.pct ?? 0;
        case 'avgCopies':
          return averageCopiesValue(item) ?? 0;
        default:
          return item.rank ?? 9e9;
      }
    };
    const decorated = filtered().map(item => ({ item, v: valueOf(item) }));
    decorated.sort((a, b) => mul * (a.v - b.v));
    return decorated.map(d => d.item);
  });

  // Header clicks toggle direction on the active column and reset to the
  // metric's natural direction when moving to a new one.
  function changeSort(key: SortKey) {
    if (sortKey() === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(defaultDir(key));
    }
  }

  // eslint-disable-next-line solid/reactivity -- createPagination reads `sorted` inside its own createMemo (a tracked scope); the analyzer can't see through the helper
  const { page, totalPages, pageItems, setPage } = createPagination(
    sorted,
    PAGE_SIZE,
    [debouncedQuery, typeFilter, subtype, reg, aceSpec, priceBand, sortKey, tournament],
    pageSignal
  );

  function gotoCard(item: CardItem) {
    if (!item.set || item.number === undefined) {
      return;
    }
    navigate(`/cards/${item.set}/${item.number}`);
  }

  // Changing the top-level type invalidates any contextual subtype (a trainer
  // subtype is meaningless once Energy is selected), so clear it in lockstep.
  function selectType(next: TypeFilter) {
    setTypeFilter(next);
    setSubtype('all');
  }

  // Subtype options for whichever specific type is selected; empty for
  // Pokémon / "all", which suppresses the group entirely.
  const subtypeOptions = () => {
    const t = typeFilter();
    return t === 'trainer' || t === 'energy' ? SUBTYPE_OPTIONS[t] : [];
  };

  function setSort(key: SortKey) {
    setSortKey(key);
    setSortDir(defaultDir(key));
  }

  function clearFilters() {
    setTypeFilter('all');
    setSubtype('all');
    setReg('all');
    setAceSpec('false');
    setPriceBand('all');
  }

  // Removable summary chips shown under the mobile control row when filters are
  // active and the sheet is closed. Each carries the label and its own clear.
  const summaryChips = () => {
    const chips: { key: string; label: string; clear: () => void }[] = [];
    const t = typeFilter();
    if (t !== 'all') {
      const label = t === 'pokemon' ? 'Pokémon' : t === 'trainer' ? 'Trainer' : 'Energy';
      chips.push({ key: 'type', label, clear: () => selectType('all') });
    }
    if (subtype() !== 'all') {
      const opt = subtypeOptions().find(o => o.value === subtype());
      chips.push({ key: 'subtype', label: opt?.label ?? subtype(), clear: () => setSubtype('all') });
    }
    if (reg() !== 'all') {
      chips.push({ key: 'reg', label: `Reg ${reg()}`, clear: () => setReg('all') });
    }
    if (aceSpec() === 'true') {
      chips.push({ key: 'ace', label: 'Ace Spec', clear: () => setAceSpec('false') });
    }
    if (priceBand() !== 'all') {
      const opt = PRICE_BANDS.find(o => o.value === priceBand());
      chips.push({ key: 'price', label: opt?.label ?? priceBand(), clear: () => setPriceBand('all') });
    }
    return chips;
  };

  // The five metadata filter groups, shared verbatim by the mobile sheet and
  // the desktop disclosure panel so the two surfaces never drift apart. Sort
  // and View stay out: they are sheet-only additions (desktop keeps its
  // segmented controls inline).
  const FilterGroups = () => (
    <>
      <div class='group'>
        <p class='group-label'>Card type</p>
        <ChipGroup
          options={[
            { value: 'all', label: 'All types' },
            { value: 'pokemon', label: 'Pokémon' },
            { value: 'trainer', label: 'Trainer' },
            { value: 'energy', label: 'Energy' }
          ]}
          selected={typeFilter()}
          onSelect={v => selectType(v as TypeFilter)}
        />
      </div>

      <Show when={subtypeOptions().length > 0}>
        <div class='group'>
          <p class='group-label'>Subtype</p>
          <ChipGroup
            options={[{ value: 'all', label: 'All subtypes' }, ...subtypeOptions()]}
            selected={subtype()}
            onSelect={setSubtype}
          />
        </div>
      </Show>

      <div class='group'>
        <p class='group-label'>Regulation mark</p>
        <p class='group-caption'>Post-rotation legality</p>
        <ChipGroup
          options={[{ value: 'all', label: 'All regs' }, ...REG_MARKS.map(m => ({ value: m, label: `Reg ${m}` }))]}
          selected={reg()}
          onSelect={v => setReg(v as RegMark)}
        />
      </div>

      <div class='group group-inline'>
        <p class='group-label'>Ace Spec</p>
        <div class='chips'>
          <button
            type='button'
            class='chip'
            aria-pressed={aceSpec() === 'true' ? 'true' : 'false'}
            onClick={() => setAceSpec(v => (v === 'true' ? 'false' : 'true'))}
          >
            Ace Spec only
          </button>
        </div>
      </div>

      <div class='group'>
        <p class='group-label'>Price band</p>
        <ChipGroup
          options={[{ value: 'all', label: 'All prices' }, ...PRICE_BANDS]}
          selected={priceBand()}
          onSelect={v => setPriceBand(v as 'all' | PriceBand)}
        />
      </div>
    </>
  );

  return (
    <>
      <section class='hero hero-collapsible'>
        <h1>Cards</h1>
        <div class='hero-meta'>
          <Show when={masterData()} fallback={<Skeleton width='240px' height='13px' />}>
            <span>{masterData()!.items.length.toLocaleString()} cards observed</span>
            <span class='dot'>·</span>
            <span>{masterData()!.deckTotal.toLocaleString()} decks analyzed</span>
            <span class='dot'>·</span>
            <span>{scopeLabel()}</span>
          </Show>
        </div>
      </section>

      <Section>
        {/* Desktop filter bar — search plus display controls stay inline; the
            metadata facets hide behind the same funnel trigger as mobile,
            opening an in-flow panel instead of a sheet. Hidden on mobile. */}
        <div class='filter-bar cards-filter-bar'>
          <div class='filter-row'>
            <SearchInput value={query()} onInput={setQuery} placeholder='Search cards by name...' />
            <button
              type='button'
              class='filters-btn filters-btn--labeled'
              classList={{ 'is-active': activeFilterCount() > 0, 'is-open': panelOpen() }}
              aria-expanded={panelOpen() ? 'true' : 'false'}
              aria-controls='cards-filter-panel'
              onClick={() => setPanelOpen(o => !o)}
            >
              <svg
                width='14'
                height='14'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
                stroke-linecap='round'
                stroke-linejoin='round'
                aria-hidden='true'
              >
                <path d='M3 5h18l-7 8v5.5l-4 2V13L3 5z' />
              </svg>
              Filters
              <Show when={activeFilterCount() > 0}>
                <span class='fb-count'>{activeFilterCount()}</span>
              </Show>
            </button>
            <Segmented<ViewMode>
              options={VIEW_OPTIONS}
              selected={viewMode()}
              onSelect={setViewMode}
              ariaLabel='View mode'
            />
            <Segmented<SortKey> options={SORT_OPTIONS} selected={sortKey()} onSelect={setSort} ariaLabel='Sort by' />
          </div>
          <Show when={panelOpen()}>
            <div class='cards-filter-panel' id='cards-filter-panel'>
              <FilterGroups />
            </div>
          </Show>
        </div>

        {/* Mobile control row — full-width search + a square filter trigger of
            matching height. Hidden on desktop. */}
        <div class='cards-mobile-controls'>
          <div class='control-row'>
            <SearchInput value={query()} onInput={setQuery} placeholder='Search cards by name...' />
            <button
              type='button'
              class='filters-btn'
              classList={{ 'is-active': activeFilterCount() > 0 }}
              aria-haspopup='dialog'
              aria-expanded={sheetOpen() ? 'true' : 'false'}
              aria-label='Refine cards'
              onClick={() => setSheetOpen(o => !o)}
            >
              <svg
                width='16'
                height='16'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
                stroke-linecap='round'
                stroke-linejoin='round'
                aria-hidden='true'
              >
                <path d='M3 5h18l-7 8v5.5l-4 2V13L3 5z' />
              </svg>
              <Show when={activeFilterCount() > 0}>
                <span class='fb-count'>{activeFilterCount()}</span>
              </Show>
            </button>
          </div>
        </div>

        {/* Active-filter summary: removable mini-chips, shown on every
            breakpoint whenever filters are set (the facets themselves are
            hidden behind the trigger, so this is the at-rest state readout). */}
        <Show when={summaryChips().length > 0}>
          <div class='filter-strip' aria-label='Active filters'>
            <For each={summaryChips()}>
              {chip => (
                <button
                  type='button'
                  class='mini-chip'
                  aria-label={`Remove ${chip.label} filter`}
                  onClick={() => chip.clear()}
                >
                  {chip.label}
                  <span class='mc-x' aria-hidden='true'>
                    ✕
                  </span>
                </button>
              )}
            </For>
          </div>
        </Show>
      </Section>

      <BottomSheet
        open={sheetOpen()}
        onClose={() => setSheetOpen(false)}
        title='Refine'
        ariaLabel='Refine cards'
        footer={
          <>
            <button class='sheet-clear' type='button' onClick={clearFilters}>
              Clear
            </button>
            <button class='btn sheet-apply' type='button' onClick={() => setSheetOpen(false)}>
              Show {filtered().length.toLocaleString()} cards
            </button>
          </>
        }
      >
        <FilterGroups />

        <div class='group'>
          <p class='group-label'>Sort by</p>
          <ChipGroup options={SHEET_SORT_OPTIONS} selected={sortKey()} onSelect={v => setSort(v as SortKey)} />
        </div>

        <div class='group'>
          <p class='group-label'>View</p>
          <ChipGroup options={VIEW_OPTIONS} selected={viewMode()} onSelect={v => setViewMode(v as ViewMode)} />
        </div>
      </BottomSheet>

      <Section>
        <Show
          when={masterData()}
          fallback={
            <Show when={master.error} fallback={<ViewSkeleton mode={viewMode()} />}>
              <EmptyState
                title="Couldn't load card data."
                description='Refresh to try again.'
                actions={
                  <button class='btn btn-secondary' type='button' onClick={() => void refetchMaster()}>
                    Retry
                  </button>
                }
              />
            </Show>
          }
        >
          <Show
            when={pageItems().length > 0}
            fallback={
              <EmptyState
                title='No cards match.'
                description='Try removing a filter or changing the search term.'
                actions={
                  <button
                    class='btn btn-secondary'
                    type='button'
                    onClick={() => {
                      setQuery('');
                      clearFilters();
                      setSortKey('rank');
                    }}
                  >
                    Clear filters
                  </button>
                }
              />
            }
          >
            <Show
              when={viewMode() === 'grid'}
              fallback={
                <ListView
                  items={pageItems()}
                  priceFor={priceFor}
                  onCardClick={gotoCard}
                  sortKey={sortKey()}
                  sortDir={sortDir()}
                  onSort={changeSort}
                />
              }
            >
              <div class='cards-grid'>
                <For each={pageItems()}>
                  {(item, i) => <CardTile card={item} hideEmptyBuckets eagerImage={i() < 8} />}
                </For>
              </div>
            </Show>

            <Show when={totalPages() > 1}>
              <Pagination page={page()} totalPages={totalPages()} onChange={setPage} />
            </Show>
          </Show>
        </Show>
      </Section>
    </>
  );
}

/* ---------- List view ---------- */

function SortableTh(props: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
  num?: boolean;
}) {
  const active = () => props.activeKey === props.sortKey;
  return (
    <th
      class='sortable'
      classList={{ num: props.num }}
      aria-sort={active() ? (props.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button class='th-sort' type='button' onClick={() => props.onSort(props.sortKey)}>
        {props.label}
        <Show when={active()}>
          <span class='sort-mark' aria-hidden='true'>
            {props.dir === 'asc' ? '▲' : '▼'}
          </span>
        </Show>
      </button>
    </th>
  );
}

function ListView(props: {
  items: CardItem[];
  priceFor: (item: CardItem) => number | null;
  onCardClick: (item: CardItem) => void;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  return (
    <div class='table-wrap'>
      <table class='data'>
        <thead>
          <tr>
            <th class='num'>#</th>
            <SortableTh
              label='Card'
              sortKey='name'
              activeKey={props.sortKey}
              dir={props.sortDir}
              onSort={props.onSort}
            />
            <th>Set</th>
            <th>Type</th>
            <SortableTh
              label='Inclusion'
              sortKey='inclusion'
              activeKey={props.sortKey}
              dir={props.sortDir}
              onSort={props.onSort}
              num
            />
            <SortableTh
              label='Avg copies'
              sortKey='avgCopies'
              activeKey={props.sortKey}
              dir={props.sortDir}
              onSort={props.onSort}
              num
            />
            <SortableTh
              label='Price'
              sortKey='price'
              activeKey={props.sortKey}
              dir={props.sortDir}
              onSort={props.onSort}
              num
            />
          </tr>
        </thead>
        <tbody>
          <For each={props.items}>
            {item => {
              const price = createMemo(() => props.priceFor(item));
              return (
                <tr
                  class='is-link'
                  onClick={() => props.onCardClick(item)}
                  tabIndex={0}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      props.onCardClick(item);
                    }
                  }}
                >
                  <td class='num muted-cell'>{item.rank ?? '—'}</td>
                  <td>
                    <span class='cardname'>{item.name}</span>
                  </td>
                  <td class='muted-cell'>{item.set ? `${item.set}/${item.number}` : '—'}</td>
                  <td class='muted-cell'>{categoryLabel(item)}</td>
                  <td class='num'>{item.pct.toFixed(1)}%</td>
                  <td class='num muted-cell'>{averageCopies(item)}</td>
                  <td class='num'>
                    <Show when={price() !== null} fallback={<span class='muted-cell'>—</span>}>
                      ${price()!.toFixed(2)}
                    </Show>
                  </td>
                </tr>
              );
            }}
          </For>
        </tbody>
      </table>
    </div>
  );
}

function ViewSkeleton(props: { mode: ViewMode }) {
  return (
    <Show
      when={props.mode === 'list'}
      fallback={
        <div class='cards-grid'>
          <For each={Array.from({ length: 14 })}>
            {() => (
              <div>
                <Skeleton height='180px' rounded='10px' />
                <Skeleton height='14px' style={{ 'margin-top': '8px' }} />
                <Skeleton height='11px' style={{ 'margin-top': '4px' }} />
              </div>
            )}
          </For>
        </div>
      }
    >
      <div class='table-wrap'>
        <table class='data'>
          <thead>
            <tr>
              <th class='num'>#</th>
              <th>Card</th>
              <th>Set</th>
              <th>Type</th>
              <th class='num'>Inclusion</th>
              <th class='num'>Avg copies</th>
              <th class='num'>Price</th>
            </tr>
          </thead>
          <tbody>
            <For each={Array.from({ length: 12 })}>
              {() => (
                <tr>
                  <td class='num'>
                    <Skeleton width='20px' />
                  </td>
                  <td>
                    <Skeleton width='60%' />
                  </td>
                  <td>
                    <Skeleton width='50px' />
                  </td>
                  <td>
                    <Skeleton width='80px' />
                  </td>
                  <td class='num'>
                    <Skeleton width='40px' />
                  </td>
                  <td class='num'>
                    <Skeleton width='36px' />
                  </td>
                  <td class='num'>
                    <Skeleton width='44px' />
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
    </Show>
  );
}
