import { createMemo, createResource, For, onMount, Show, type Signal } from 'solid-js';
import { useSearchParams } from '@solidjs/router';
import { fetchEarnings } from '../lib/data';
import { resolved } from '../lib/resource';
import { Section } from '../components/Section';
import { Segmented } from '../components/Segmented';
import { Pagination } from '../components/Pagination';
import { Skeleton } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { createPagination } from '../lib/pagination';
import { parseISODate, shortDate } from '../lib/format';
import {
  type EarningsLens,
  type EarningsRow,
  formatEarnings,
  rankByLens,
  shortSeasonLabel
} from '../utils/earningsRanking';
import '../styles/pages/players-tables.css';
import '../styles/pages/earnings.css';

const PAGE_SIZE = 50;
const LENSES: readonly EarningsLens[] = ['career', 'best', 'season'];

export function EarningsPage() {
  const [payload] = createResource(fetchEarnings);

  // Lens and page live in the URL so a shared link lands on the same view.
  // `career` and page 1 are omitted, keeping the bare /tools/earnings canonical.
  const [params, setParams] = useSearchParams<{ lens?: string; page?: string }>();
  const lens = (): EarningsLens =>
    LENSES.includes(params.lens as EarningsLens) ? (params.lens as EarningsLens) : 'career';
  const setLens = (next: EarningsLens) =>
    setParams({ lens: next === 'career' ? undefined : next, page: undefined }, { replace: true });

  onMount(() => {
    document.title = 'Earnings — Ciphermaniac';
  });

  // Non-suspending read: navigation commits immediately and the skeleton below
  // does the waiting (see lib/resource.ts).
  const data = () => resolved(payload);

  /** Newest season in the payload — what the third lens ranks. */
  const currentSeason = () => data()?.seasons[0] ?? null;

  const rows = createMemo<EarningsRow[]>(() => {
    const loaded = data();
    const season = currentSeason();
    if (!loaded || !season) {
      return [];
    }
    return rankByLens(loaded.players, lens(), season.key);
  });

  const pageParam: Signal<number> = [
    () => {
      const n = Number(params.page);
      return Number.isInteger(n) && n > 1 ? n : 1;
    },
    (p => {
      const next = typeof p === 'function' ? p(pageParam[0]()) : p;
      setParams({ page: next > 1 ? String(next) : undefined }, { replace: true });
      return next;
    }) as Signal<number>[1]
  ];
  // No resetOn list: setLens already clears `page` itself.
  const { page, totalPages, pageItems, setPage } =
    // eslint-disable-next-line solid/reactivity -- createPagination reads `rows` inside its own createMemo (a tracked scope); the analyzer can't see through the helper
    createPagination(rows, PAGE_SIZE, undefined, pageParam);

  const lensOptions = createMemo(() => {
    const season = currentSeason();
    return [
      { value: 'career' as const, label: 'Career' },
      { value: 'best' as const, label: 'Best season' },
      { value: 'season' as const, label: season ? shortSeasonLabel(season.label) : 'This season' }
    ];
  });

  /** Header for the amount column; also names what the ranking means. */
  const amountHeader = () => lensOptions().find(o => o.value === lens())?.label ?? 'Earnings';

  const seasonLabel = (key: string | null) => {
    const season = data()?.seasons.find(s => s.key === key);
    return season ? shortSeasonLabel(season.label) : null;
  };

  const heroMeta = () => {
    const loaded = data();
    if (!loaded) {
      return null;
    }
    const updated = shortDate(parseISODate(loaded.generatedAt));
    return (
      <>
        <span>{loaded.players.length.toLocaleString()} players</span>
        <span class='dot'>·</span>
        <span>{loaded.seasons.length} seasons</span>
        <span class='dot'>·</span>
        <span>Prize data from Limitless, updated {updated}</span>
      </>
    );
  };

  return (
    <>
      <section class='hero'>
        <h1>Earnings</h1>
        <div class='hero-meta'>{heroMeta()}</div>
      </section>

      <Section>
        <Segmented<EarningsLens> options={lensOptions()} selected={lens()} onSelect={setLens} ariaLabel='Rank by' />
      </Section>

      {/* No section heading: the hero names the page and Pagination's
          "Showing 1–50 of 932" carries the per-lens row count. */}
      <Section>
        <Show
          when={data()}
          fallback={
            <Show when={payload.error} fallback={<TableSkeleton />}>
              <EmptyState
                title='Earnings data unavailable'
                description="The earnings file didn't load. Try again in a moment."
              />
            </Show>
          }
        >
          <Show
            when={pageItems().length > 0}
            fallback={<EmptyState title='Nobody ranked here.' description='No player has earnings under this view.' />}
          >
            <div class='table-wrap'>
              <table class='data'>
                <thead>
                  <tr>
                    <th class='earnings-rank'>#</th>
                    <th>Player</th>
                    <th>Country</th>
                    <th class='num'>{amountHeader()}</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={pageItems()}>
                    {row => (
                      <tr>
                        <td class='earnings-rank'>{row.rank.toLocaleString()}</td>
                        <td>
                          <a
                            class='cardname'
                            href={`https://limitlesstcg.com/players/${row.player.id}`}
                            target='_blank'
                            rel='noopener'
                          >
                            {row.player.name}
                          </a>
                        </td>
                        <td class='muted-cell'>{row.player.country || '—'}</td>
                        <td class='num'>
                          {formatEarnings(row.amount)}
                          <Show when={lens() === 'best' && seasonLabel(row.seasonKey)}>
                            {label => <span class='earnings-season'>{label()}</span>}
                          </Show>
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
            <Show when={totalPages() > 1}>
              <Pagination
                page={page()}
                totalPages={totalPages()}
                onChange={setPage}
                pageSize={PAGE_SIZE}
                totalItems={rows().length}
              />
            </Show>
          </Show>
        </Show>
      </Section>
    </>
  );
}

function TableSkeleton() {
  return (
    <div class='table-wrap'>
      <table class='data'>
        <thead>
          <tr>
            <th class='earnings-rank'>#</th>
            <th>Player</th>
            <th>Country</th>
            <th class='num'>Career</th>
          </tr>
        </thead>
        <tbody>
          <For each={Array.from({ length: 10 })}>
            {() => (
              <tr>
                <td class='earnings-rank'>
                  <Skeleton width='16px' />
                </td>
                <td>
                  <Skeleton width='60%' />
                </td>
                <td>
                  <Skeleton width='40px' />
                </td>
                <td class='num'>
                  <Skeleton width='64px' />
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}
