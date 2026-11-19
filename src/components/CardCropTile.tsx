import { A } from '@solidjs/router';
import type { CardItem } from '../types';
import { CardImage } from './CardImage';
import { cardHref, CardTileOverlay, CardTileSet } from './CardTile';
import { prefetchCardPage } from '../lib/prefetch';
import { cropFrame, type CropFrame } from './cardCropFrame';

/**
 * Rendered art width per frame, for the image's `sizes`: the tile's width
 * (46vw on a phone, about 170px on desktop) over the share of the card it shows.
 */
const FRAME_SIZES: Record<CropFrame, string> = {
  pokemon: '(max-width: 640px) 64vw, 238px',
  'pokemon-ex': '(max-width: 640px) 69vw, 255px',
  trainer: '(max-width: 640px) 65vw, 241px',
  'energy-special': '(max-width: 640px) 54vw, 200px',
  'energy-basic': '(max-width: 640px) 62vw, 230px'
};

/** Compact grid cell: the card's illustration with its histogram and usage bar. */
export function CardCropTile(props: { card: CardItem; hideEmptyBuckets?: boolean }) {
  const frame = () => cropFrame(props.card);
  const title = () =>
    `${props.card.name} · ${props.card.set ?? ''} ${props.card.number ?? ''} · ${props.card.found.toLocaleString()} / ${props.card.total.toLocaleString()} decks`;
  return (
    <A
      class='card-crop'
      href={cardHref(props.card)}
      title={title()}
      onMouseEnter={prefetchCardPage}
      onFocus={prefetchCardPage}
    >
      <div class={`card-crop-art is-${frame()}`}>
        <CardImage
          set={props.card.set ?? '?'}
          number={props.card.number ?? '?'}
          size='sm'
          sizes={FRAME_SIZES[frame()]}
          alt={`${props.card.name} card`}
        />
        <div class='card-tile-shade' aria-hidden='true' />
        <CardTileOverlay card={props.card} hideEmptyBuckets={props.hideEmptyBuckets} />
      </div>
      <div class='card-tile-name-row'>
        <span class='card-tile-name'>{props.card.name}</span>
        <CardTileSet card={props.card} />
      </div>
    </A>
  );
}
