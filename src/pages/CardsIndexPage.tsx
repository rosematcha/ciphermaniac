import { createMemo, createSignal, For, type JSX, onMount, Show } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { useTournament } from '../lib/tournamentContext';
import type { CardItem } from '../types';
import { Section } from '../components/Section';
import { ChipGroup, SearchInput } from '../components/Chip';
import { Segmented } from '@ciphermaniac/design/components/Segmented';
import { Pagination } from '../components/Pagination';
import { Skeleton } from '@ciphermaniac/design/components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { CardTile } from '../components/CardTile';
import { CardHoverPreview } from '../components/CardHoverPreview';
import { BottomSheet } from '../components/BottomSheet';
import { createPagination } from '../lib/pagination';
import { debounced } from '../lib/debounce';
import { latestValue } from '../lib/resource';
import { averageCopies, categoryLabel } from '../lib/cardStats';
import { foldSearch } from '../utils/searchFold';
import { matchesCardFilters } from '../lib/cardFilters';
import {
  createPersistentNumberSignal,
  createPersistentSignal,
  createPersistentViewMode
} from '../lib/persistentSignal';
import { createCardFilterState } from './cardsIndex/filterState';
import { FilterGroups, FilterStrip } from './cardsIndex/FilterGroups';
import { createCardSortState, priceOf, sortCards, type SortDir, type SortKey } from './cardsIndex/sorting';
import { createPricedRows } from './cardsIndex/pricedRows';
import '../styles/pages/cards.css';

type ViewMode = 'grid' | 'list';

// Divisible by every column count .cards-index-grid allows (1-4, 6, 7), so a
// full page always ends on a full row.
const PAGE_SIZE = 84;

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

const VIEW_OPTIONS: { value: ViewMode; label: string }[] = [
  { value: 'grid', label: 'Grid' },
  { value: 'list', label: 'List' }
];

export function CardsIndexPage() {
  const { tournament } = useTournament();
  const [query, setQuery] = createPersistentSignal<string>('cm:cardsQuery', '', v => v, sessionStorage);
  const { sortKey, setSortKey, sortDir, changeSort, setSort } = createCardSortState();
  const [viewMode, setViewMode] = createPersistentViewMode('cm:cardsView');
  const filters = createCardFilterState();
  const { activeFilterCount, clearFilters } = filters;
  const { master, rows, retry } = createPricedRows(
    tournament,
    () => filters.priceBand() !== 'all' || sortKey() === 'price'
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

  // Non-suspending reads (see lib/resource.ts). `latestValue` keeps the old
  // table in place while a tournament switch refetches — better than a
  // skeleton flash for context-keyed data.
  const masterData = () => latestValue(master);

  // The input binds the raw `query` signal so typing echoes instantly; the
  // filter → sort → 60-tile render chain reads this debounced view so it runs
  // once per pause instead of once per keystroke.
  const debouncedQuery = debounced(query, 150);

  const priceFor = (item: CardItem): number | null => priceOf(rows().prices, item);

  const filtered = createMemo(() => {
    const { items } = rows();
    const q = foldSearch(debouncedQuery().trim());
    const cardFilters = filters.cardFilters();
    return items.filter(item => {
      if (!item.set || item.number === undefined) {
        return false;
      }
      if (q && !foldSearch(item.name).includes(q)) {
        return false;
      }
      // Price is only resolved when a band filter is active — the lookup is a
      // string build + map read we'd rather skip for the common case.
      const price = cardFilters.priceBand === 'all' ? null : priceFor(item);
      return matchesCardFilters(item, cardFilters, price);
    });
  });

  const sorted = createMemo(() => sortCards(filtered(), sortKey(), sortDir(), priceFor));

  const { page, totalPages, pageItems, setPage } = createPagination(
    sorted,
    PAGE_SIZE,
    [
      debouncedQuery,
      filters.typeFilter,
      filters.subtype,
      filters.reg,
      filters.aceSpec,
      filters.priceBand,
      sortKey,
      tournament
    ],
    pageSignal
  );

  function gotoCard(item: CardItem) {
    if (!item.set || item.number === undefined) {
      return;
    }
    navigate(`/cards/${item.set}/${item.number}`);
  }

  return (
    <>
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
              <FilterGroups filters={filters} />
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

        <FilterStrip filters={filters} />
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
        <FilterGroups filters={filters} />

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
                  <button class='btn btn-secondary' type='button' onClick={retry}>
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
              <CardsIndexGrid>
                <For each={pageItems()}>
                  {(item, i) => <CardTile card={item} hideEmptyBuckets eagerImage={i() < 8} />}
                </For>
              </CardsIndexGrid>
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
  class?: string;
}) {
  const active = () => props.activeKey === props.sortKey;
  return (
    <th
      class={`sortable${props.class ? ` ${props.class}` : ''}`}
      classList={{ num: props.num }}
      aria-sort={active() ? (props.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button class='th-sort' type='button' onClick={() => props.onSort(props.sortKey)}>
        {props.label}
        {/* Always present, hidden when inactive — see the note in
            ArchetypesIndexPage's SortHeader. */}
        <span class='sort-mark' classList={{ 'is-idle': !active() }} aria-hidden='true'>
          {props.dir === 'asc' ? '▲' : '▼'}
        </span>
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
    <div class='table-wrap cards-list'>
      <table class='data'>
        <thead>
          <tr>
            <th class='num cards-rank-col'>#</th>
            <SortableTh
              label='Card'
              sortKey='name'
              activeKey={props.sortKey}
              dir={props.sortDir}
              onSort={props.onSort}
            />
            <th class='cards-set-col'>Set</th>
            <th class='cards-type-col'>Type</th>
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
              class='cards-copies-col'
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
                  <td class='num muted-cell cards-rank-col'>{item.rank ?? '—'}</td>
                  <td class='cards-name-col'>
                    <Show
                      when={item.set && item.number !== undefined}
                      fallback={<span class='cardname'>{item.name}</span>}
                    >
                      <CardHoverPreview set={item.set!} number={item.number!}>
                        <span class='cardname'>{item.name}</span>
                      </CardHoverPreview>
                    </Show>
                  </td>
                  <td class='muted-cell cards-set-col'>{item.set ? `${item.set}/${item.number}` : '—'}</td>
                  <td class='muted-cell cards-type-col'>{categoryLabel(item)}</td>
                  <td class='num'>{item.pct.toFixed(1)}%</td>
                  <td class='num muted-cell cards-copies-col'>{averageCopies(item)}</td>
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

// The wrapper is the size container the 5-column skip in components.css
// queries; the skeleton shares it so loading and loaded tiles match.
function CardsIndexGrid(props: { children: JSX.Element }) {
  return (
    <div class='cards-index-grid'>
      <div class='cards-grid'>{props.children}</div>
    </div>
  );
}

function ViewSkeleton(props: { mode: ViewMode }) {
  return (
    <Show
      when={props.mode === 'list'}
      fallback={
        <CardsIndexGrid>
          {/* Built from the tile's own classes rather than fixed pixel heights:
              the card box is 140% of its column width, so a flat 180px block
              was short by a different amount at every breakpoint. */}
          <For each={Array.from({ length: 14 })}>
            {() => (
              <div class='card-tile card-tile-skeleton' aria-hidden='true'>
                <div class='card-tile-card' />
                <div class='card-tile-meta'>
                  <div class='card-tile-name-row'>
                    <Skeleton width='60%' height='1em' />
                  </div>
                  <div class='card-tile-decks'>
                    <Skeleton width='80%' height='1em' />
                  </div>
                </div>
              </div>
            )}
          </For>
        </CardsIndexGrid>
      }
    >
      <div class='table-wrap cards-list'>
        <table class='data'>
          <thead>
            <tr>
              <th class='num cards-rank-col'>#</th>
              <th>Card</th>
              <th class='cards-set-col'>Set</th>
              <th class='cards-type-col'>Type</th>
              <th class='num'>Inclusion</th>
              <th class='num cards-copies-col'>Avg copies</th>
              <th class='num'>Price</th>
            </tr>
          </thead>
          <tbody>
            <For each={Array.from({ length: 12 })}>
              {() => (
                <tr>
                  <td class='num cards-rank-col'>
                    <Skeleton width='20px' />
                  </td>
                  <td class='cards-name-col'>
                    <Skeleton width='60%' />
                  </td>
                  <td class='cards-set-col'>
                    <Skeleton width='50px' />
                  </td>
                  <td class='cards-type-col'>
                    <Skeleton width='80px' />
                  </td>
                  <td class='num'>
                    <Skeleton width='40px' />
                  </td>
                  <td class='num cards-copies-col'>
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
