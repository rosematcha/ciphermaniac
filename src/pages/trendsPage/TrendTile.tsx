import { A } from '@solidjs/router';
import { type JSX, Show } from 'solid-js';
import { CardImage } from '../../components/CardImage';
import { prefetchCardPage } from '../../lib/prefetch';
import { signedPercent, wholePercent } from './weekly';

interface TrendTileProps {
  name: string;
  set: string | null;
  number: string | null;
  /** The change, in share points, printed big over the art. */
  delta: number;
  /** The level now, printed small beside it, or a preformatted string. */
  level: number | string;
  /** Optional line under the name (the deck that drove a mover). */
  meta?: JSX.Element;
  eagerImage?: boolean;
}

/**
 * The Trends page's card tile: the cards-page tile with the usage bar and
 * histogram gone. A deeper bottom shade carries two figures over the art, the
 * signed change big at the left with only the arrow coloured, and the level
 * small at the right. Nothing under the name but the set code.
 */
export function TrendTile(props: TrendTileProps) {
  const href = () => (props.set && props.number ? `/cards/${props.set}/${props.number}` : '#');
  const up = () => props.delta > 0;
  const level = () => (typeof props.level === 'string' ? props.level : wholePercent(props.level));
  return (
    <A class='card-tile trend-tile' href={href()} onMouseEnter={prefetchCardPage} onFocus={prefetchCardPage}>
      <div class='card-tile-card'>
        <Show when={props.set && props.number}>
          <CardImage
            set={props.set ?? '?'}
            number={props.number ?? '?'}
            size='sm'
            sizes='(max-width: 640px) 30vw, 164px'
            alt={`${props.name} card`}
            lazy={props.eagerImage ? false : undefined}
          />
        </Show>
        <div class='card-tile-shade' aria-hidden='true' />
        <div class='card-tile-overlay'>
          <span class='trend-tile-change' classList={{ up: up(), down: !up() }}>
            <span class='trend-tile-arrow' aria-hidden='true'>
              {up() ? '↑' : '↓'}
            </span>
            {signedPercent(props.delta)}
          </span>
          <span class='trend-tile-level'>{level()}</span>
        </div>
      </div>
      <div class='card-tile-meta'>
        <div class='card-tile-name-row'>
          <span class='card-tile-name'>{props.name}</span>
          <Show when={props.set && props.number}>
            <span class='card-tile-set'>
              {props.set} {props.number}
            </span>
          </Show>
        </div>
        <Show when={props.meta}>
          <div class='card-tile-decks trend-tile-meta'>{props.meta}</div>
        </Show>
      </div>
    </A>
  );
}
