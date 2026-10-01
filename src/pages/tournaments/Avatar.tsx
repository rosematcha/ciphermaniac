import { Show } from 'solid-js';

/** An account's small picture, or its name's initial where the provider gave none. */
export function Avatar(props: { name: string; src: string | null }) {
  return (
    <Show when={props.src} fallback={<span class='tm-avatar tm-initial'>{props.name.slice(0, 1)}</span>}>
      {src => <img class='tm-avatar' src={src()} alt='' width='40' height='40' />}
    </Show>
  );
}
