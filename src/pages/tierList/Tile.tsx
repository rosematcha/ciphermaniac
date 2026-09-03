/**
 * The three things a tier can hold: an archetype as sprite icons, an archetype
 * as a 1:1 card-stack preview, or a single card art at 5:7.
 *
 * Every tile is `.tl-item` with a `data-id`, which is the whole contract the
 * sortable needs. Captions are always rendered and hidden by a body-scoped
 * rule — scoping to the board would drop them the moment a tile is reparented
 * mid-drag, which is exactly when it is most visible.
 * @module pages/tierList/Tile
 */

import { For, type JSX, Show } from 'solid-js';
import { ArchetypeIcons } from '../../components/ArchetypeIcon';
import { CardImage } from '../../components/CardImage';
import { Icon } from './icons';
import type { TierItem } from './model';

interface TileProps {
  item: TierItem;
  /** Opens the editor for an archetype the user invented. */
  onEdit?: (customId: number) => void;
}

/**
 * Only custom archetypes carry an edit affordance, and it sits at opacity 0
 * until the tile is hovered or focused — present for the user, invisible to
 * the export, which never hovers anything.
 */
function EditButton(props: TileProps): JSX.Element {
  return (
    <Show when={props.item.customId !== undefined}>
      <button
        type='button'
        class='tl-edit'
        // The popover re-finds its anchor by selector after a render, so the
        // pencil has to be addressable without holding on to the node.
        data-edit={props.item.customId}
        aria-label={`Edit ${props.item.label}`}
        // The tile under it is draggable; a press on the pencil must not
        // become the start of a drag.
        onPointerDown={e => e.stopPropagation()}
        onClick={() => props.onEdit?.(props.item.customId!)}
      >
        <Icon name='edit' />
      </button>
    </Show>
  );
}

export function Tile(props: TileProps): JSX.Element {
  return (
    <Show when={props.item.kind !== 'art'} fallback={<ArtTile {...props} />}>
      <Show when={props.item.kind === 'preview'} fallback={<IconTile {...props} />}>
        <PreviewTile {...props} />
      </Show>
    </Show>
  );
}

function IconTile(props: TileProps): JSX.Element {
  return (
    <div class='tl-item' data-id={props.item.id}>
      <div class='tl-ico'>
        <ArchetypeIcons slugs={props.item.icons ?? []} size={26} />
        {/* `.cap`, not a bare span: `ArchetypeIcons` renders a span too, and a
            rule that hides every span in here takes the sprites with it. */}
        <span class='cap'>{props.item.label}</span>
      </div>
      <EditButton {...props} />
    </div>
  );
}

function PreviewTile(props: TileProps): JSX.Element {
  const thumbs = (): string[] => props.item.thumbs ?? [];
  return (
    <div class='tl-item tl-prev' data-id={props.item.id} title={props.item.label}>
      <div class='box'>
        <Show
          when={thumbs().length > 0}
          // A custom archetype built with only sprites has no cards to show
          // here, so the box carries its name rather than sitting blank.
          fallback={<div class='tl-noart'>{props.item.label}</div>}
        >
          <div class={`card-stack card-stack-${Math.min(3, thumbs().length)}`}>
            <For each={thumbs().slice(0, 3)}>
              {thumb => {
                const [set, number] = thumb.split('/');
                return (
                  <div class='card-stack-slot'>
                    <CardImage set={set ?? ''} number={number ?? ''} size='xs' lazy skipR2 />
                  </div>
                );
              }}
            </For>
          </div>
        </Show>
      </div>
      <div class='cap'>{props.item.label}</div>
      <EditButton {...props} />
    </div>
  );
}

function ArtTile(props: TileProps): JSX.Element {
  return (
    <div class='tl-item tl-art' data-id={props.item.id} title={props.item.label}>
      <CardImage set={props.item.set ?? ''} number={props.item.number ?? ''} size='sm' lazy skipR2 />
      <div class='cap'>{props.item.label}</div>
    </div>
  );
}
