import { createMemo, createResource, createSignal, For, onMount, Show, type Signal } from 'solid-js';
import { useSearchParams } from '@solidjs/router';
import { fetchEarnings, fetchEarningsEvents } from '../lib/data';
import { resolved } from '../lib/resource';
import { Section } from '../components/Section';
import { Segmented } from '../components/Segmented';
import { Pagination } from '../components/Pagination';
import { Skeleton } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { createPagination } from '../lib/pagination';
import { parseISODate, shortDate } from '../lib/format';
import {
  eventAmount,
  eventsInSeason,
  ordinalPlace,
  type SeasonSummary,
  summarizeSeasons
} from '../utils/earningsBreakdown';
import type { EarningsEvent } from '../../shared/earningsTypes';
import {
  type EarningsBasis,
  type EarningsLens,
  type EarningsRow,
  formatEarnings,
  rankByLens,
  shortSeasonLabel
} from '../utils/earningsRanking';
import '../styles/pages/players-tables.css';
import '../styles/pages/earnings.css';

const PAGE_SIZE = 50;
const LENSES: readonly EarningsLens[] = ['career', 'top-seasons', 'current'];
const BASES: readonly EarningsBasis[] = ['actual', 'adjusted'];
const BASIS_OPTIONS: { value: EarningsBasis; label: string }[] = [
  { value: 'actual', label: 'As paid' },
  { value: 'adjusted', label: "Today's payouts" }
];

export function EarningsPage() {
  const [payload] = createResource(fetchEarnings);

  // Lens and page live in the URL so a shared link lands on the same view.
  // `career` and page 1 are omitted, keeping the bare /tools/earnings canonical.
  const [params, setParams] = useSearchParams<{ lens?: string; basis?: string; page?: string }>();
  const lens = (): EarningsLens =>
    LENSES.includes(params.lens as EarningsLens) ? (params.lens as EarningsLens) : 'career';
  const setLens = (next: EarningsLens) =>
    setParams({ lens: next === 'career' ? undefined : next, page: undefined }, { replace: true });
  const basis = (): EarningsBasis =>
    BASES.includes(params.basis as EarningsBasis) ? (params.basis as EarningsBasis) : 'actual';
  const setBasis = (next: EarningsBasis) =>
    setParams({ basis: next === 'actual' ? undefined : next, page: undefined }, { replace: true });

  onMount(() => {
    document.title = 'Earnings — Ciphermaniac';
  });

  // Non-suspending read: navigation commits immediately and the skeleton below
  // does the waiting (see lib/resource.ts).
  const data = () => resolved(payload);

  /** Newest season in the payload — what the third lens ranks. */
  const currentSeason = () => data()?.seasons[0] ?? null;

  // Per-event detail is three times the size of the leaderboard, so it is only
  // requested once a visitor actually opens a row. One row is open at a time:
  // these panels are tall, and two of them push the table off screen.
  const [wantEvents, setWantEvents] = createSignal(false);
  const [eventsData] = createResource(wantEvents, fetchEarningsEvents);
  const [openRow, setOpenRow] = createSignal<string | null>(null);

  const rowKey = (row: EarningsRow) => `${row.player.id}:${row.seasonKey ?? 'career'}`;
  const toggleRow = (row: EarningsRow) => {
    const key = rowKey(row);
    setOpenRow(current => (current === key ? null : key));
    setWantEvents(true);
  };
  const eventsFor = (playerId: string): EarningsEvent[] | undefined => resolved(eventsData)?.events[playerId];

  const rows = createMemo<EarningsRow[]>(() => {
    const loaded = data();
    const season = currentSeason();
    if (!loaded || !season) {
      return [];
    }
    return rankByLens(loaded.players, lens(), season.key, basis());
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
  // No resetOn list: setLens and setBasis already clear `page` themselves.
  const { page, totalPages, pageItems, setPage } =
    // eslint-disable-next-line solid/reactivity -- createPagination reads `rows` inside its own createMemo (a tracked scope); the analyzer can't see through the helper
    createPagination(rows, PAGE_SIZE, undefined, pageParam);

  const lensOptions = createMemo(() => {
    const season = currentSeason();
    return [
      { value: 'career' as const, label: 'Career' },
      { value: 'top-seasons' as const, label: 'Top seasons' },
      { value: 'current' as const, label: season ? shortSeasonLabel(season.label) : 'This season' }
    ];
  });

  /** Header for the amount column; also names what the ranking means. */
  const amountHeader = () => lensOptions().find(o => o.value === lens())?.label ?? 'Earnings';

  const seasonLabel = (key: string | null) => {
    const season = data()?.seasons.find(s => s.key === key);
    return season ? shortSeasonLabel(season.label) : null;
  };

  /**
   * The line renders its full structure from the first paint, with the two
   * counts and the stamp in reserved slots.
   *
   * Returning null until the payload landed left the hero a single reserved
   * line and then filled it with two lines' worth of text on a phone, dropping
   * the table below it 19px. The words are known up front; only the numbers
   * are not.
   */
  const heroMeta = () => {
    const loaded = data();
    const updated = loaded ? shortDate(parseISODate(loaded.generatedAt)) : null;
    return (
      <>
        <span>
          <span class='num-slot' style={{ 'min-width': '5ch' }}>
            {loaded?.players.length.toLocaleString() ?? ''}
          </span>{' '}
          players
        </span>
        <span class='dot'>·</span>
        <span>
          <span class='num-slot'>{loaded?.seasons.length ?? ''}</span> seasons
        </span>
        <span class='dot'>·</span>
        <span>
          Prize data from Limitless, updated{' '}
          <span class='num-slot' style={{ 'min-width': '4em' }}>
            {updated ?? ''}
          </span>
        </span>
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
        <div class='earnings-controls'>
          <Segmented<EarningsLens> options={lensOptions()} selected={lens()} onSelect={setLens} ariaLabel='Rank by' />
          <Segmented<EarningsBasis>
            options={BASIS_OPTIONS}
            selected={basis()}
            onSelect={setBasis}
            ariaLabel='Pay scale'
          />
        </div>
        <p class='earnings-note'>
          <Show when={basis() === 'adjusted'} fallback={<>Prize money as it was paid at the time.</>}>
            Every finish paid at the{' '}
            <a href={data()?.payoutSource} target='_blank' rel='noopener'>
              current published rates
            </a>
            . Regionals, Internationals and Worlds only; Nationals count at International rates and Special
            Championships at Regional rates. Junior and Senior finishes pay from their own, lower column.
          </Show>
        </p>
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
                    <th class='num expand-col' aria-label='Expand' />
                    <th>Player</th>
                    <th>Country</th>
                    <th class='num'>{amountHeader()}</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={pageItems()}>
                    {row => (
                      <BreakdownRow
                        row={row}
                        basis={basis()}
                        seasonLabel={seasonLabel}
                        expanded={openRow() === rowKey(row)}
                        onToggle={() => toggleRow(row)}
                        events={eventsFor(row.player.id)}
                        loading={eventsData.loading}
                        failed={Boolean(eventsData.error)}
                      />
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

/**
 * One leaderboard row, plus the panel it opens.
 *
 * What the panel shows follows the lens the row came from: a career row has no
 * season attached and breaks down into per-season lines, while a season row
 * breaks down into that season's finishes.
 */
function BreakdownRow(props: {
  row: EarningsRow;
  basis: EarningsBasis;
  seasonLabel: (key: string | null) => string | null;
  expanded: boolean;
  onToggle: () => void;
  events: EarningsEvent[] | undefined;
  loading: boolean;
  failed: boolean;
}) {
  return (
    <>
      <tr class='is-link' onClick={() => props.onToggle()}>
        <td class='earnings-rank'>{props.row.rank.toLocaleString()}</td>
        <td class='num expand-col'>
          <button
            type='button'
            class='row-caret'
            classList={{ open: props.expanded }}
            aria-expanded={props.expanded}
            aria-label={props.expanded ? 'Hide breakdown' : 'Show breakdown'}
            onClick={e => {
              e.stopPropagation();
              props.onToggle();
            }}
          >
            ▸
          </button>
        </td>
        <td>
          {/* Stops the row toggle so a click on the name still leaves for Limitless. */}
          <a
            class='cardname'
            href={`https://limitlesstcg.com/players/${props.row.player.id}`}
            target='_blank'
            rel='noopener'
            onClick={e => e.stopPropagation()}
          >
            {props.row.player.name}
          </a>
        </td>
        <td class='muted-cell'>{props.row.player.country || '—'}</td>
        <td class='num'>
          {formatEarnings(props.row.amount)}
          <Show when={props.row.seasonKey && props.seasonLabel(props.row.seasonKey)}>
            {label => <span class='earnings-season'>{label()}</span>}
          </Show>
        </td>
      </tr>
      <Show when={props.expanded}>
        <tr class='row-expansion'>
          <td colspan={5}>
            <BreakdownPanel
              events={props.events}
              loading={props.loading}
              failed={props.failed}
              basis={props.basis}
              seasonKey={props.row.seasonKey}
              seasonLabel={props.seasonLabel}
            />
          </td>
        </tr>
      </Show>
    </>
  );
}

function BreakdownPanel(props: {
  events: EarningsEvent[] | undefined;
  loading: boolean;
  failed: boolean;
  basis: EarningsBasis;
  seasonKey: string | null;
  seasonLabel: (key: string | null) => string | null;
}) {
  // <Show> rather than a plain `if`: the events file lands after the first
  // expand, and the body has to re-evaluate when it does.
  return (
    <Show
      when={props.events}
      fallback={
        <div class='row-expansion-empty'>
          <Show when={!props.failed} fallback={<>Couldn't load the event breakdown.</>}>
            <Show when={props.loading} fallback={<>No events recorded for this player.</>}>
              <Skeleton width='220px' height='14px' />
            </Show>
          </Show>
        </div>
      }
    >
      {events => (
        <Show
          when={props.seasonKey}
          fallback={<SeasonLines rows={summarizeSeasons(events(), props.basis)} seasonLabel={props.seasonLabel} />}
        >
          {season => <EventLines events={eventsInSeason(events(), season())} basis={props.basis} />}
        </Show>
      )}
    </Show>
  );
}

/** Career breakdown: one line per season that earned money. */
function SeasonLines(props: { rows: SeasonSummary[]; seasonLabel: (key: string | null) => string | null }) {
  return (
    <Show
      when={props.rows.length > 0}
      fallback={<div class='row-expansion-empty'>No earning seasons under this pay scale.</div>}
    >
      <table class='earnings-breakdown'>
        <tbody>
          <For each={props.rows}>
            {season => (
              <tr>
                <td class='bd-season'>{props.seasonLabel(season.season) ?? season.season}</td>
                <td class='bd-meta'>
                  {season.eventCount.toLocaleString()} {season.eventCount === 1 ? 'event' : 'events'}
                </td>
                <td class='bd-meta'>Best {ordinalPlace(season.bestPlace)}</td>
                <td class='num bd-amount'>{formatEarnings(season.amount)}</td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </Show>
  );
}

/** Season breakdown: every finish that season, paying or not. */
function EventLines(props: { events: EarningsEvent[]; basis: EarningsBasis }) {
  return (
    <Show
      when={props.events.length > 0}
      fallback={<div class='row-expansion-empty'>No events recorded for this season.</div>}
    >
      <table class='earnings-breakdown'>
        <tbody>
          <For each={props.events}>
            {event => (
              <tr classList={{ 'bd-unpaid': eventAmount(event, props.basis) === 0 }}>
                <td class='bd-place'>{ordinalPlace(event.place)}</td>
                <td class='bd-event'>{event.name}</td>
                <td class='num bd-amount'>
                  {eventAmount(event, props.basis) > 0 ? formatEarnings(eventAmount(event, props.basis)) : '—'}
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </Show>
  );
}

function TableSkeleton() {
  return (
    <div class='table-wrap'>
      <table class='data'>
        <thead>
          <tr>
            <th class='earnings-rank'>#</th>
            <th class='num expand-col' aria-label='Expand' />
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
                <td class='num expand-col' />
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
