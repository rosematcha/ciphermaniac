import { createMemo, createResource, For, onMount, Show } from 'solid-js';
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
import { createPagination } from '../lib/pagination';
import { averageCopies, categoryLabel } from '../lib/cardStats';
import {
  createPersistentNumberSignal,
  createPersistentSignal,
  createPersistentViewMode
} from '../lib/persistentSignal';

type SortKey = 'rank' | 'name' | 'price';
type TypeFilter = 'all' | 'pokemon' | 'trainer' | 'energy';
type ViewMode = 'grid' | 'list';

const PAGE_SIZE = 60;
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
  const [master] = createResource(tournament, fetchMaster);
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
    v => (v === 'rank' || v === 'name' || v === 'price' ? v : null),
    sessionStorage
  );
  const [viewMode, setViewMode] = createPersistentViewMode('cm:cardsView');
  const pageSignal = createPersistentNumberSignal('cm:cardsPage', 1, sessionStorage);
  const navigate = useNavigate();

  onMount(() => {
    document.title = 'Cards — Ciphermaniac';
  });

  const scopeLabel = () => (tournament() === ONLINE_META_NAME ? ONLINE_META_LABEL : prettyTournamentName(tournament()));

  const filtered = createMemo(() => {
    const items = master()?.items ?? [];
    const q = query().trim().toLowerCase();
    const filter = typeFilter();
    return items.filter(item => {
      if (!item.set || item.number === undefined) {
        return false;
      }
      if (filter !== 'all') {
        const cat = (item.category ?? '').toLowerCase();
        if (filter === 'pokemon' && !cat.startsWith('pokemon')) {
          return false;
        }
        if (filter === 'trainer' && !cat.startsWith('trainer')) {
          return false;
        }
        if (filter === 'energy' && !cat.startsWith('energy')) {
          return false;
        }
      }
      if (q && !item.name.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  });

  const priceFor = (item: CardItem): number | null => {
    const map = prices();
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

  const sorted = createMemo(() => {
    const list = [...filtered()];
    const key = sortKey();
    list.sort((a, b) => {
      switch (key) {
        case 'rank':
          return (a.rank ?? 9e9) - (b.rank ?? 9e9);
        case 'name':
          return a.name.localeCompare(b.name);
        case 'price': {
          const pa = priceFor(a);
          const pb = priceFor(b);
          if (pa === null && pb === null) {
            return (a.rank ?? 9e9) - (b.rank ?? 9e9);
          }
          if (pa === null) {
            return 1;
          }
          if (pb === null) {
            return -1;
          }
          return pb - pa;
        }
        default:
          return 0;
      }
    });
    return list;
  });

  const { page, totalPages, pageItems, setPage } = createPagination(
    sorted,
    PAGE_SIZE,
    [query, typeFilter, sortKey, tournament],
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
      <section class='hero'>
        <h1>Cards</h1>
        <div class='hero-meta'>
          <Show when={master()} fallback={<Skeleton width='240px' height='13px' />}>
            <span>{master()!.items.length.toLocaleString()} cards observed</span>
            <span class='dot'>·</span>
            <span>{master()!.deckTotal.toLocaleString()} decks analyzed</span>
            <span class='dot'>·</span>
            <span>{scopeLabel()}</span>
          </Show>
        </div>
      </section>

      <Section>
        <div class='filter-bar'>
          <div class='filter-row'>
            <SearchInput value={query()} onInput={setQuery} placeholder='Search cards by name...' />
            <Segmented<ViewMode>
              options={VIEW_OPTIONS}
              selected={viewMode()}
              onSelect={setViewMode}
              ariaLabel='View mode'
            />
            <Segmented<SortKey> options={SORT_OPTIONS} selected={sortKey()} onSelect={setSortKey} ariaLabel='Sort by' />
          </div>
          <div class='filter-row'>
            <ChipGroup
              options={[
                { value: 'all', label: 'All types' },
                { value: 'pokemon', label: 'Pokémon' },
                { value: 'trainer', label: 'Trainer' },
                { value: 'energy', label: 'Energy' }
              ]}
              selected={typeFilter()}
              onSelect={v => setTypeFilter(v as TypeFilter)}
            />
          </div>
        </div>
      </Section>

      <Section right={`${filtered().length.toLocaleString()} matching`}>
        <Show
          when={master() && !master.error}
          fallback={
            <Show when={master.error} fallback={<ViewSkeleton mode={viewMode()} />}>
              <EmptyState title="Couldn't load cards." description={String(master.error)} />
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
                      setTypeFilter('all');
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
              fallback={<ListView items={pageItems()} priceFor={priceFor} onCardClick={gotoCard} />}
            >
              <div class='cards-grid'>
                <For each={pageItems()}>{item => <CardTile card={item} />}</For>
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

function ListView(props: {
  items: CardItem[];
  priceFor: (item: CardItem) => number | null;
  onCardClick: (item: CardItem) => void;
}) {
  return (
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
          <For each={props.items}>
            {item => (
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
                  <Show when={props.priceFor(item) !== null} fallback={<span class='muted-cell'>—</span>}>
                    ${props.priceFor(item)!.toFixed(2)}
                  </Show>
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}

function ViewSkeleton(props: { mode: ViewMode }) {
  if (props.mode === 'list') {
    return (
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
    );
  }
  return (
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
  );
}
