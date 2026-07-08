import { createSignal, For, Show } from 'solid-js';

/**
 * Pokémon sprite icons. Slugs are lowercase and hyphenated with form
 * suffixes, e.g. `dragapult`, `greninja-mega`, `raging-bolt`.
 *
 * Primary source is our own R2 mirror (scripts/mirror-archetype-sprites.ts)
 * so archetype icons follow the same same-origin-ish posture as card art —
 * not subject to Limitless CDN bot-blocking or availability. Any sprite the
 * mirror doesn't have yet falls back to Limitless, then hides on a second
 * failure.
 */
const ICON_BASE = 'https://r2.ciphermaniac.com/pokemon-sprites/gen9';
const ICON_FALLBACK_BASE = 'https://r2.limitlesstcg.net/pokemon/gen9';

/** Paired icons overlap by this many px (kept in sync with `.arche-icons` CSS). */
const ICON_OVERLAP = 6;

interface ArchetypeIconsProps {
  /** Representative Pokémon icon slugs (up to two are rendered). */
  slugs: string[];
  /** Icon edge length in px (default 22). */
  size?: number;
  /** Optional class added to the wrapper. */
  class?: string;
  /**
   * Reserve a fixed two-icon-wide slot — and render the wrapper even with no
   * icons — so labels in a vertical list line up in a column regardless of
   * whether an archetype has one, two, or zero icons.
   */
  reserveSlot?: boolean;
}

/**
 * Renders an archetype's representative Pokémon icon(s) inline. A broken icon
 * hides itself rather than showing a placeholder, so a bad slug degrades to "no
 * icon" instead of visual noise. Renders nothing when `slugs` is empty (unless
 * `reserveSlot` is set), so it can be dropped into any archetype-name cell
 * unconditionally.
 */
export function ArchetypeIcons(props: ArchetypeIconsProps) {
  const size = () => props.size ?? 22;
  const shown = () => props.slugs.slice(0, 2);
  const slotWidth = () => size() * 2 - ICON_OVERLAP;
  return (
    <Show when={props.reserveSlot || shown().length > 0}>
      <span
        class={`arche-icons ${props.class ?? ''}`}
        style={props.reserveSlot ? { 'min-width': `${slotWidth()}px` } : undefined}
        aria-hidden='true'
      >
        <For each={shown()}>{slug => <ArchetypeIcon slug={slug} size={size()} />}</For>
      </span>
    </Show>
  );
}

function ArchetypeIcon(props: { slug: string; size: number }) {
  // 0 = mirror, 1 = Limitless fallback, 2 = give up and hide.
  const [sourceStage, setSourceStage] = createSignal(0);
  const src = () => `${sourceStage() === 0 ? ICON_BASE : ICON_FALLBACK_BASE}/${props.slug}.png`;
  return (
    <Show when={sourceStage() < 2}>
      <img
        class='arche-icon'
        src={src()}
        alt=''
        width={props.size}
        height={props.size}
        loading='lazy'
        decoding='async'
        referrerpolicy='no-referrer'
        onError={() => setSourceStage(s => s + 1)}
      />
    </Show>
  );
}
