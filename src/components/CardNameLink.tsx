import { A } from '@solidjs/router';
import { Show } from 'solid-js';
import { CardHoverPreview } from './CardHoverPreview';
import '../styles/card-name-link.css';

interface CardNameLinkProps {
  name: string;
  set?: string;
  number?: string | number;
}

/**
 * A card's name in a table's name cell: a link to its page, with the art
 * preview on hover. A card with no print to link to is plain text.
 */
export function CardNameLink(props: CardNameLinkProps) {
  return (
    <Show when={props.set && props.number !== undefined} fallback={<span class='cardname'>{props.name}</span>}>
      <CardHoverPreview set={props.set!} number={props.number!}>
        <A href={`/cards/${props.set}/${props.number}`} class='cardname'>
          {props.name}
        </A>
      </CardHoverPreview>
    </Show>
  );
}
