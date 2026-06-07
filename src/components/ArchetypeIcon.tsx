import { createSignal, For, Show } from 'solid-js';

/**
 * Base URL for Limitless's clean Pokémon sprite icons. Slugs are lowercase and
 * hyphenated with form suffixes, e.g. `dragapult`, `greninja-mega`, `raging-bolt`.
 * Hotlinked directly (no CORS, no storage) — same posture as CardImage.
 */
const ICON_BASE = 'https://r2.limitlesstcg.net/pokemon/gen9';

interface ArchetypeIconsProps {
  /** Representative Pokémon icon slugs (up to two are rendered). */
  slugs: string[];
  /** Icon edge length in px (default 22). */
  size?: number;
  /** Optional class added to the wrapper. */
  class?: string;
}

/**
 * Renders an archetype's representative Pokémon icon(s) inline. A broken icon
 * hides itself rather than showing a placeholder, so a bad slug degrades to "no
 * icon" instead of visual noise. Renders nothing when `slugs` is empty, so it can
 * be dropped into any archetype-name cell unconditionally.
 */
export function ArchetypeIcons(props: ArchetypeIconsProps) {
  const size = () => props.size ?? 22;
  const shown = () => props.slugs.slice(0, 2);
  return (
    <Show when={shown().length > 0}>
      <span class={`arche-icons ${props.class ?? ''}`} aria-hidden='true'>
        <For each={shown()}>{slug => <ArchetypeIcon slug={slug} size={size()} />}</For>
      </span>
    </Show>
  );
}

function ArchetypeIcon(props: { slug: string; size: number }) {
  const [errored, setErrored] = createSignal(false);
  return (
    <Show when={!errored()}>
      <img
        class='arche-icon'
        src={`${ICON_BASE}/${props.slug}.png`}
        alt=''
        width={props.size}
        height={props.size}
        loading='lazy'
        decoding='async'
        referrerpolicy='no-referrer'
        onError={() => setErrored(true)}
      />
    </Show>
  );
}
