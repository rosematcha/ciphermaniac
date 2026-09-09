/**
 * Quick rank: the whole unranked pile, one archetype at a time.
 *
 * Dragging thirty-five tiles into six rows is a fine desktop afternoon and a
 * bad phone minute — each move is a press, a scroll and a release, and the pile
 * is never on screen with the tier it is headed for. Here the item is the
 * screen and the tiers are buttons under it, so a full list is thirty-five taps
 * with nothing to aim at.
 *
 * It ranks from the top of the pile down. Skip sends the current item to the
 * back rather than dropping it, so nothing leaves the queue unranked without
 * having been looked at.
 * @module pages/tierList/QuickRank
 */

import { createMemo, createSignal, For, type JSX, Show } from 'solid-js';
import { ArchetypeIcons } from '../../components/ArchetypeIcon';
import { CardImage } from '../../components/CardImage';
import { swatch } from './palette';
import type { Tier, TierItem } from './model';

interface QuickRankProps {
  /** The unranked pile, in the order the tray shows it. */
  items: readonly TierItem[];
  tiers: readonly Tier[];
  /** Place `itemId` at the end of `tierId`. */
  onPlace: (itemId: string, tierId: string) => void;
  onClose: () => void;
}

/**
 * The item the queue is on, drawn at a size worth tapping about — sprites for
 * an archetype, the art itself for a card.
 */
function Face(props: { item: TierItem }): JSX.Element {
  return (
    <div class='tl-qface'>
      <Show
        when={props.item.kind === 'art'}
        fallback={<ArchetypeIcons slugs={props.item.icons ?? []} size={72} placeholder />}
      >
        <CardImage set={props.item.set ?? ''} number={props.item.number ?? ''} size='sm' />
      </Show>
      <b>{props.item.label}</b>
    </div>
  );
}

export function QuickRank(props: QuickRankProps): JSX.Element {
  // Skipping rotates rather than advances, so a position in the pile is not
  // enough to say what is up next: the order is held here and the pile is read
  // through it. Ids, not items, so a re-render of the tray does not strand it,
  // and empty to begin with — anything the order has not seen keeps the tray's
  // own order, which is what an untouched queue should be.
  const [order, setOrder] = createSignal<string[]>([]);

  const queue = createMemo<TierItem[]>(() => {
    const unranked = new Map(props.items.map(item => [item.id, item]));
    const known = order()
      .map(id => unranked.get(id))
      .filter((item): item is TierItem => item !== undefined);
    // Anything the tray has that the queue has not seen — an archetype invented
    // while this was open — joins the back rather than being ranked invisibly.
    const seen = new Set(known.map(item => item.id));
    return [...known, ...props.items.filter(item => !seen.has(item.id))];
  });

  const current = (): TierItem | undefined => queue()[0];

  const place = (tierId: string): void => {
    const item = current();
    if (!item) {
      return;
    }
    setOrder(queue().map(entry => entry.id));
    props.onPlace(item.id, tierId);
  };

  const skip = (): void => {
    const [first, ...rest] = queue();
    if (first) {
      setOrder([...rest.map(item => item.id), first.id]);
    }
  };

  return (
    <div class='tl-queue' role='dialog' aria-modal='true' aria-label='Quick rank'>
      <div class='tl-qhead'>
        <span class='num'>{queue().length} left</span>
        <button type='button' class='tl-btn' onClick={() => props.onClose()}>
          Done
        </button>
      </div>

      <Show
        when={current()}
        fallback={
          <div class='tl-qface'>
            <b>Everything is ranked.</b>
          </div>
        }
      >
        {item => <Face item={item()} />}
      </Show>

      <div class='tl-plates'>
        <For each={props.tiers}>
          {tier => (
            <button
              type='button'
              class='tl-platebtn'
              style={{ '--plate': swatch(tier.swatch).hex }}
              disabled={!current()}
              onClick={() => place(tier.id)}
            >
              <span class='tl-plate-name'>{tier.name}</span>
            </button>
          )}
        </For>
      </div>

      <button type='button' class='tl-btn tl-skip' disabled={queue().length < 2} onClick={skip}>
        Skip
      </button>
    </div>
  );
}
