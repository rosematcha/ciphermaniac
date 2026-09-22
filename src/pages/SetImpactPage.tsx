import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { A, useSearchParams } from '@solidjs/router';
import { fetchSetImpact } from '../lib/data/setImpact';
import { resolved } from '../lib/resource';
import { Section } from '../components/Section';
import { Segmented } from '../components/Segmented';
import { Skeleton } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { CardImage } from '../components/CardImage';
import { SetPanel } from './setImpact/SetPanel';
import { Note, NOTES } from './setImpact/notes';
import type { SetImpactAttribution } from '../../shared/setImpact/types';
import {
  defaultDirection,
  formatShare,
  MIN_MAJORS,
  type SetImpactRow,
  setImpactRows,
  type SetImpactSortColumn,
  type SortDirection,
  sortSetImpactRows
} from '../utils/setImpactRows';
import '../styles/pages/set-impact.css';

const ATTRIBUTION_OPTIONS: { value: SetImpactAttribution; label: string }[] = [
  { value: 'new', label: 'New to Standard' },
  { value: 'legal', label: 'Keeps it legal' }
];
const THUMBNAILS = 4;
/** Must match the phone breakpoint in set-impact.css, which hides the wide columns. */
const PHONE_QUERY = '(max-width: 640px)';
const WIDE_COLUMNS = 2;

/**
 * The columns a row spans. Cells hidden with display: none leave the table's
 * grid, so the panel row has to span only the columns still showing, or the
 * table grows phantom columns and squeezes the rest.
 */
function createVisibleColumns(): () => number {
  const query = window.matchMedia(PHONE_QUERY);
  const [phone, setPhone] = createSignal(query.matches);
  const update = () => setPhone(query.matches);
  query.addEventListener('change', update);
  onCleanup(() => query.removeEventListener('change', update));
  return () => COLUMNS.length + 1 - (phone() ? WIDE_COLUMNS : 0);
}

export function SetImpactPage() {
  const [payload] = createResource(fetchSetImpact);
  const data = () => resolved(payload);

  // The toggle lives in the URL so a shared link lands on the same view; the
  // default is omitted to keep the bare path canonical.
  const [params, setParams] = useSearchParams<{ attr?: string }>();
  const attribution = (): SetImpactAttribution => (params.attr === 'legal' ? 'legal' : 'new');

  const [sortColumn, setSortColumn] = createSignal<SetImpactSortColumn>('lifetime');
  const [sortDirection, setSortDirection] = createSignal<SortDirection>('descending');
  const toggleSort = (column: SetImpactSortColumn) => {
    if (sortColumn() === column) {
      setSortDirection(direction => (direction === 'ascending' ? 'descending' : 'ascending'));
      return;
    }
    setSortColumn(column);
    setSortDirection(defaultDirection(column));
  };

  const rows = createMemo(() => {
    const loaded = data();
    return loaded ? sortSetImpactRows(setImpactRows(loaded, attribution()), sortColumn(), sortDirection()) : [];
  });

  // The panel shows the picked set, or the table's first row until one is picked.
  const [picked, setPicked] = createSignal<string | null>(null);
  const selected = () => rows().find(row => row.code === picked()) ?? rows()[0];

  onMount(() => {
    document.title = 'Set Impact — Ciphermaniac';
  });

  return (
    <>
      <section class='hero'>
        <h1>Set Impact</h1>
      </section>

      <Section>
        <div class='set-impact-controls'>
          <div class='set-impact-control'>
            <Segmented<SetImpactAttribution>
              options={ATTRIBUTION_OPTIONS}
              selected={attribution()}
              onSelect={next => setParams({ attr: next === 'new' ? undefined : next }, { replace: true })}
              ariaLabel='Credit reprints to'
            />
            <Note text={NOTES.attribution} />
          </div>
        </div>
      </Section>

      <Section>
        <Show
          when={data()}
          fallback={
            <Show when={payload.error} fallback={<TableSkeleton />}>
              <EmptyState title='Set Impact data unavailable' description="The data file didn't load." />
            </Show>
          }
        >
          <div class='set-impact-layout'>
            <div>
              <ImpactTable
                rows={rows()}
                sortColumn={sortColumn()}
                sortDirection={sortDirection()}
                onSort={toggleSort}
                selected={selected()?.code ?? null}
                onSelect={setPicked}
              />
              <p class='set-impact-note'>* Predicted. Greyed sets were seen at fewer than {MIN_MAJORS} majors.</p>
            </div>
            <Show when={selected()}>
              {row => (
                <aside class='set-impact-panel'>
                  <SetPanel row={row()} />
                </aside>
              )}
            </Show>
          </div>
        </Show>
      </Section>
    </>
  );
}

const COLUMNS: { column: SetImpactSortColumn; label: string; class: string; note?: string }[] = [
  { column: 'name', label: 'Set', class: 'set-impact-name' },
  { column: 'majors', label: 'Majors', class: 'num set-impact-wide', note: NOTES.majors },
  { column: 'perMajor', label: 'Cards per deck', class: 'num', note: NOTES.perMajor },
  { column: 'lifetime', label: 'Lifetime', class: 'num set-impact-lifetime', note: NOTES.lifetime }
];

function ImpactTable(props: {
  rows: SetImpactRow[];
  sortColumn: SetImpactSortColumn;
  sortDirection: SortDirection;
  onSort: (column: SetImpactSortColumn) => void;
  selected: string | null;
  onSelect: (code: string) => void;
}) {
  const maxLifetime = () => Math.max(0, ...props.rows.filter(row => row.ranked).map(row => row.lifetime));
  const span = createVisibleColumns();
  return (
    <div class='table-wrap set-impact-table'>
      <table class='data'>
        <thead>
          <tr>
            <For each={COLUMNS}>
              {col => (
                <th
                  class={`${col.class} sortable`}
                  aria-sort={props.sortColumn === col.column ? props.sortDirection : 'none'}
                >
                  <div class='set-impact-th'>
                    <button type='button' class='th-sort' onClick={() => props.onSort(col.column)}>
                      {col.label}
                      <span
                        class='sort-mark'
                        classList={{ 'is-idle': props.sortColumn !== col.column }}
                        aria-hidden='true'
                      >
                        {props.sortDirection === 'ascending' ? '▲' : '▼'}
                      </span>
                    </button>
                    <Show when={col.note}>{note => <Note text={note()} />}</Show>
                  </div>
                </th>
              )}
            </For>
            <th class='set-impact-wide'>
              Most played <Note text={NOTES.mostPlayed} />
            </th>
          </tr>
        </thead>
        <tbody>
          <For each={props.rows}>
            {row => (
              <ImpactRow
                row={row}
                maxLifetime={maxLifetime()}
                span={span()}
                selected={props.selected === row.code}
                onSelect={() => props.onSelect(row.code)}
              />
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}

/**
 * One set. The whole row picks it for the panel; the name is also a button so
 * the pick is reachable from the keyboard. On a phone the panel opens as a row
 * under the set instead of beside the table.
 */
function ImpactRow(props: {
  row: SetImpactRow;
  maxLifetime: number;
  span: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const width = () => (props.maxLifetime > 0 ? Math.min(100, (props.row.lifetime / props.maxLifetime) * 100) : 0);
  return (
    <>
      <tr
        class='is-link'
        classList={{ 'is-selected': props.selected, 'is-unranked': !props.row.ranked }}
        onClick={() => props.onSelect()}
      >
        <td class='set-impact-name'>
          <button type='button' class='set-impact-pick' aria-pressed={props.selected}>
            {props.row.name} <span class='set-impact-code'>{props.row.code}</span>
          </button>
        </td>
        <td class='num set-impact-wide'>{props.row.majors}</td>
        <td class='num'>{props.row.perMajor.toFixed(1)}</td>
        <td class='num set-impact-lifetime'>
          <div class='set-impact-bar'>
            <div class='set-impact-track'>
              <div class='set-impact-fill' style={{ width: `${width()}%` }} />
            </div>
            <span class='set-impact-value'>{props.row.lifetime.toFixed(1)}</span>
          </div>
        </td>
        <td class='set-impact-wide'>
          <div class='set-impact-thumbs'>
            <For each={props.row.cards.slice(0, THUMBNAILS)}>
              {card => (
                <A
                  href={`/cards/${card.set}/${card.number}`}
                  title={`${card.name} · ${formatShare(card.share)}`}
                  onClick={e => e.stopPropagation()}
                >
                  <CardImage set={card.set} number={card.number} size='xs' alt={card.name} />
                </A>
              )}
            </For>
          </div>
        </td>
      </tr>
      <Show when={props.selected}>
        <tr class='set-impact-inline'>
          <td colspan={props.span}>
            <SetPanel row={props.row} />
          </td>
        </tr>
      </Show>
    </>
  );
}

function TableSkeleton() {
  return (
    <div class='table-wrap set-impact-table'>
      <table class='data'>
        <thead>
          <tr>
            <For each={COLUMNS}>{col => <th class={col.class}>{col.label}</th>}</For>
            <th class='set-impact-wide'>Most played</th>
          </tr>
        </thead>
        <tbody>
          <For each={Array.from({ length: 12 })}>
            {() => (
              <tr>
                <td class='set-impact-name'>
                  <Skeleton width='60%' />
                </td>
                <For each={COLUMNS.slice(1)}>
                  {col => (
                    <td class={col.class}>
                      <Skeleton width='36px' />
                    </td>
                  )}
                </For>
                <td class='set-impact-wide'>
                  <Skeleton width='110px' />
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}
