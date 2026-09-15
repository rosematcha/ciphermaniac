import { A } from '@solidjs/router';
import { createMemo, For, Show } from 'solid-js';
import { CardHoverPreview } from './CardHoverPreview';
import { groupDeckByCategory } from '../lib/deckGrouping';
import { capitalize } from '../lib/format';

/** One line of a published decklist. */
export interface DeckListCard {
  count: number;
  name: string;
  set?: string;
  number?: string;
  category?: string;
}

/**
 * A full decklist grouped into Pokemon / Trainer / Energy, with counts, hover
 * previews, and links to each card's page.
 */
export function DeckList(props: { cards: DeckListCard[] }) {
  const groups = createMemo(() => groupDeckByCategory(props.cards));

  return (
    <div class='deck-inline'>
      <div class='deck-inline-groups'>
        <For each={groups()}>
          {group => (
            <div class='deck-inline-group'>
              <div class='deck-inline-group-head'>
                {capitalize(group.label)}
                <span class='deck-inline-group-count'>{group.total}</span>
              </div>
              <ul class='deck-inline-list'>
                <For each={group.cards}>
                  {c => (
                    <li>
                      <Show
                        when={c.set && c.number}
                        fallback={
                          <span>
                            <b>{c.count}×</b> {c.name}
                          </span>
                        }
                      >
                        <CardHoverPreview set={c.set!} number={c.number!}>
                          <A href={`/cards/${c.set}/${c.number}`}>
                            <b>{c.count}×</b> {c.name}{' '}
                            <span class='muted-cell'>
                              {c.set}/{c.number}
                            </span>
                          </A>
                        </CardHoverPreview>
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
