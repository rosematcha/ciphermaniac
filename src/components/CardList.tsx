import { createMemo, createSignal, For, Show } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import type { CardItem } from '../types';
import { EmptyState } from './EmptyState';
import { CardTile } from './CardTile';
import { CardCropTile } from './CardCropTile';
import { cutCards } from './cardCut';
import { CardHoverPreview } from './CardHoverPreview';
import { averageCopies, categoryLabel } from '../lib/cardStats';

export type CardListItem = CardItem & {
  cardId?: string;
};

export type ViewMode = 'grid' | 'compact' | 'list';

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
        <h2>{props.title}</h2>
        <span class='right'>{props.rightSlot ?? `${props.items.length.toLocaleString()} cards`}</span>
      </div>
      <Show
        when={props.viewMode !== 'list'}
        fallback={
          <>
            <Show when={visible().length > 0}>
              <CardsTable items={visible()} />
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

function CardsTable(props: { items: readonly CardListItem[] }) {
  const navigate = useNavigate();
  const goto = (item: CardListItem) => {
    if (item.set && item.number !== undefined) {
      navigate(`/cards/${item.set}/${item.number}`);
    }
  };
  return (
    <div class='table-wrap'>
      <table class='data'>
        <thead>
          <tr>
            <th>Card</th>
            <th>Set</th>
            <th>Type</th>
            <th class='num'>Inclusion</th>
            <th class='num'>Avg copies</th>
          </tr>
        </thead>
        <tbody>
          <For each={props.items}>
            {item => (
              <tr
                class={item.set ? 'is-link' : ''}
                onClick={() => goto(item)}
                tabIndex={item.set ? 0 : -1}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    goto(item);
                  }
                }}
              >
                <td>
                  <Show
                    when={item.set && item.number !== undefined}
                    fallback={<span class='cardname'>{item.name}</span>}
                  >
                    <CardHoverPreview set={item.set!} number={item.number!}>
                      <span class='cardname'>{item.name}</span>
                    </CardHoverPreview>
                  </Show>
                </td>
                <td class='muted-cell'>{item.set ? `${item.set}/${item.number}` : '—'}</td>
                <td class='muted-cell'>{categoryLabel(item)}</td>
                <td class='num'>
                  {item.pct.toFixed(1)}%{' '}
                  <span class='muted-cell'>
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
