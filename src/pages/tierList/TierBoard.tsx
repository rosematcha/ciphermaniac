/**
 * The board and the tray.
 *
 * The board is the document: the exported JPG and this node are the same
 * element, so nothing that is not part of the artwork renders inside it at full
 * opacity. Every tier control sits on the plate and appears on row hover, which
 * means the export needs nothing stripped before it is taken.
 * @module pages/tierList/TierBoard
 */

import { For, type JSX, Show } from 'solid-js';
import { Icon } from './icons';
import { swatch } from './palette';
import { Tile } from './Tile';
import type { Tier, TierItem } from './model';

interface TierBoardProps {
  tiers: readonly Tier[];
  buckets: Map<string, TierItem[]>;
  tray: TierItem[];
  title: string;
  /** Ref to the node the exporter rasterises. */
  boardRef: (el: HTMLDivElement) => void;
  onTitle: (title: string) => void;
  onMove: (id: string, step: number) => void;
  onDelete: (id: string) => void;
  onEditTier: (id: string) => void;
  onEditItem: (customId: number) => void;
  onAddTier: () => void;
  /** Absent in card-arts view: a printing either exists or it does not. */
  onAddArchetype?: () => void;
}

/** Long names step down through two sizes rather than wrapping into fragments. */
function plateLength(name: string): 'short' | 'long' | 'xlong' {
  if (name.length > 9) {
    return 'xlong';
  }
  return name.length > 4 ? 'long' : 'short';
}

export function TierBoard(props: TierBoardProps): JSX.Element {
  return (
    <>
      <div class='tl-frame'>
        <div class='tl-board' ref={props.boardRef}>
          {/* `untitled` is what lets the export drop the masthead: on screen the
              placeholder has to stay clickable, but a JPG of someone's tier list
              should not read "Name this tier list". See `[data-exporting]`. */}
          <div class='tl-title' classList={{ untitled: !props.title }}>
            {/* No child when the title is empty: a framework-rendered empty
                text node still defeats `:empty`, so the placeholder would
                never show and the masthead would collapse to nothing. */}
            <b
              contenteditable='plaintext-only'
              spellcheck={false}
              data-placeholder='Name this tier list'
              onInput={e => props.onTitle(e.currentTarget.textContent ?? '')}
            >
              <Show when={props.title}>{text => text()}</Show>
            </b>
          </div>
          <For each={props.tiers}>
            {tier => (
              <div
                class='tl-row'
                data-row={tier.id}
                style={{ '--plate': swatch(tier.swatch).hex, '--plate-fg': swatch(tier.swatch).text }}
              >
                <div class='tl-plate' data-len={plateLength(tier.name)} data-plate={tier.id}>
                  <span class='tl-plate-name'>{tier.name}</span>
                  <span class='tl-tools'>
                    <button
                      type='button'
                      data-move={`${tier.id}:-1`}
                      title='Move up'
                      aria-label={`Move ${tier.name} up`}
                      onClick={() => props.onMove(tier.id, -1)}
                    >
                      <Icon name='up' />
                    </button>
                    <button
                      type='button'
                      data-move={`${tier.id}:1`}
                      title='Move down'
                      aria-label={`Move ${tier.name} down`}
                      onClick={() => props.onMove(tier.id, 1)}
                    >
                      <Icon name='down' />
                    </button>
                    <button
                      type='button'
                      data-tier-id={tier.id}
                      title='Rename and recolour'
                      aria-label={`Edit ${tier.name}`}
                      onClick={() => props.onEditTier(tier.id)}
                    >
                      <Icon name='edit' />
                    </button>
                    <button
                      type='button'
                      data-deltier={tier.id}
                      title='Delete tier'
                      aria-label={`Delete ${tier.name}`}
                      onClick={() => props.onDelete(tier.id)}
                    >
                      <Icon name='close' />
                    </button>
                  </span>
                </div>
                <Zone items={props.buckets.get(tier.id) ?? []} tier={tier.id} onEditItem={props.onEditItem} />
              </div>
            )}
          </For>
        </div>
      </div>

      <button class='tl-add' type='button' onClick={() => props.onAddTier()}>
        + Add tier
      </button>

      <div class='tl-tray'>
        <h4>
          Unranked <span>{props.tray.length}</span>
          <Show when={props.onAddArchetype}>
            {add => (
              <button type='button' class='tl-mini' data-addarch onClick={() => add()()}>
                + Add archetype
              </button>
            )}
          </Show>
        </h4>
        <Zone items={props.tray} tier='tray' onEditItem={props.onEditItem} />
      </div>
    </>
  );
}

function Zone(props: { items: TierItem[]; tier: string; onEditItem: (customId: number) => void }): JSX.Element {
  return (
    <div class='tl-zone' classList={{ empty: props.items.length === 0 }} data-tier={props.tier}>
      <For each={props.items}>{item => <Tile item={item} onEdit={props.onEditItem} />}</For>
    </div>
  );
}
