import { For, Show } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import type { CardItem } from '../types';
import { EmptyState } from './EmptyState';
import { CardTile } from './CardTile';
import { averageCopies, categoryLabel } from '../lib/cardStats';

export type CardListItem = CardItem & {
  cardId?: string;
};

export type ViewMode = 'grid' | 'list';

export function CardList(props: {
  title: string;
  items: CardListItem[];
  viewMode: ViewMode;
  emptyMessage: string;
  rightSlot?: string;
  hideEmptyBuckets?: boolean;
}) {
  return (
    <Show when={props.items.length > 0} fallback={<EmptyState title={props.emptyMessage} />}>
      <div class='section-head'>
        <h2>{props.title}</h2>
        <span class='right'>{props.rightSlot ?? `${props.items.length.toLocaleString()} cards`}</span>
      </div>
      <Show when={props.viewMode === 'grid'} fallback={<CardsTable items={props.items} />}>
        <div class='cards-grid'>
          <For each={props.items}>{item => <CardTile card={item} hideEmptyBuckets={props.hideEmptyBuckets} />}</For>
        </div>
      </Show>
    </Show>
  );
}

function CardsTable(props: { items: CardListItem[] }) {
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
                  <span class='cardname'>{item.name}</span>
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
