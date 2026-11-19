import { createMemo, createSignal, createUniqueId, For, Show } from 'solid-js';
import type { CardItem } from '../types';
import { EmptyState } from './EmptyState';
import { CardTile } from './CardTile';
import { CardCropTile } from './CardCropTile';
import { cutCards } from './cardCut';
import type { SkeletonColumn } from '@ciphermaniac/design/components/TableSkeleton';
import { CardNameLink } from './CardNameLink';
import { followRowLink } from '../lib/rowLink';
import { averageCopies, categoryLabel } from '../lib/cardStats';

export type CardListItem = CardItem & {
  cardId?: string;
};

export type ViewMode = 'grid' | 'compact' | 'list';

/** The list view's columns, for its table and the page's loading skeleton. */
export const CARD_COLUMNS: SkeletonColumn[] = [
  { label: 'Card', class: 'col-name', width: '55%' },
  { label: 'Set', class: 'col-secondary', width: '56px' },
  { label: 'Type', class: 'col-secondary', width: '56px' },
  { label: 'Inclusion', class: 'num', width: '40px' },
  { label: 'Avg copies', class: 'num', width: '32px' }
];

export function CardList(props: {
  title: string;
  items: CardListItem[];
  viewMode: ViewMode;
  emptyMessage: string;
  rightSlot?: string;
  hideEmptyBuckets?: boolean;
  /** Keep cards under this inclusion % behind a cell that ends the grid until
   * the reader opens it. */
  cutPct?: number;
}) {
  const [open, setOpen] = createSignal(false);
  const headingId = createUniqueId();
  const cut = createMemo(() => cutCards(props.items, props.cutPct, open()));
  const visible = () => cut().shown;
  const cutLabel = () => {
    const count = cut().under;
    return open()
      ? `Hide cards under ${props.cutPct}%`
      : `Show ${count.toLocaleString()} card${count === 1 ? '' : 's'} under ${props.cutPct}%`;
  };
  const cutButton = (cls: string) => (
    <button class={cls} type='button' aria-expanded={open()} onClick={() => setOpen(!open())}>
      {cutLabel()}
    </button>
  );
  return (
    <Show when={props.items.length > 0} fallback={<EmptyState title={props.emptyMessage} />}>
      <div class='section-head'>
        <h2 id={headingId}>{props.title}</h2>
        <span class='right'>{props.rightSlot ?? `${props.items.length.toLocaleString()} cards`}</span>
      </div>
      <Show
        when={props.viewMode !== 'list'}
        fallback={
          <>
            <Show when={visible().length > 0}>
              <CardsTable items={visible()} labelledBy={headingId} />
            </Show>
            <Show when={cut().under > 0}>
              <div class='cards-grid-more'>{cutButton('btn btn-secondary')}</div>
            </Show>
          </>
        }
      >
        <div class={props.viewMode === 'compact' ? 'card-crop-grid' : 'cards-grid'}>
          <Show
            when={props.viewMode === 'compact'}
            fallback={
              <For each={visible()}>{item => <CardTile card={item} hideEmptyBuckets={props.hideEmptyBuckets} />}</For>
            }
          >
            <For each={visible()}>{item => <CardCropTile card={item} hideEmptyBuckets={props.hideEmptyBuckets} />}</For>
          </Show>
          <Show when={cut().under > 0}>{cutButton('card-cut-cell')}</Show>
        </div>
      </Show>
    </Show>
  );
}

function CardsTable(props: { items: readonly CardListItem[]; labelledBy: string }) {
  return (
    <div class='table-wrap'>
      <table class='data' aria-labelledby={props.labelledBy}>
        <thead>
          <tr>
            <For each={CARD_COLUMNS}>{column => <th class={column.class}>{column.label}</th>}</For>
          </tr>
        </thead>
        <tbody>
          <For each={props.items}>
            {item => (
              <tr classList={{ 'is-link': Boolean(item.set) }} onClick={followRowLink}>
                <th scope='row' class='col-name'>
                  <CardNameLink name={item.name} set={item.set} number={item.number} />
                </th>
                <td class='muted-cell col-secondary'>{item.set ? `${item.set}/${item.number}` : '—'}</td>
                <td class='muted-cell col-secondary'>{categoryLabel(item)}</td>
                <td class='num'>
                  {item.pct.toFixed(1)}%{' '}
                  <span class='muted-cell col-secondary'>
                    {item.found.toLocaleString()}/{item.total.toLocaleString()}
                  </span>
                </td>
                <td class='num'>{averageCopies(item)}</td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}
