import { A } from '@solidjs/router';
import { createMemo, For, Show } from 'solid-js';
import { CardHoverPreview } from './CardHoverPreview';
import { groupDeckByCategory } from '../lib/deckGrouping';
import { capitalize } from '../lib/format';

export interface DeckBodyCard {
  count: number;
  name: string;
  set?: string;
  number?: string;
  category?: string;
}

/**
 * A decklist in three ruled columns (Pokémon, Trainer, Energy), each line a
 * link to its card page with a hover preview. `highlight` marks the lines the
 * reader came for — on a card page, the card itself.
 */
export function DeckBody(props: { cards: DeckBodyCard[]; highlight?: (card: DeckBodyCard) => boolean }) {
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
                    <li classList={{ 'is-marked': props.highlight?.(c) === true }}>
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
