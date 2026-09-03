import { createSignal, For, Show } from 'solid-js';
import { R2_ORIGIN } from '../lib/constants';

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
const ICON_BASE = `${R2_ORIGIN}/pokemon-sprites/gen9`;
const ICON_FALLBACK_BASE = 'https://r2.limitlesstcg.net/pokemon/gen9';

/**
 * The Substitute doll, for an archetype with no sprite of its own — "Other",
 * mostly, and anything whose slug has gone stale.
 *
 * Committed and served same-origin rather than mirrored, which is worth the 831
 * bytes twice over: it is the one archetype icon guaranteed to exist, and it is
 * the only one that survives the tier list's export, since a cross-origin
 * bitmap taints the canvas the rasteriser reads back.
 */
const SUBSTITUTE = '/img/substitute.png';

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
  /**
   * Stand the Substitute doll in for an archetype with no usable sprite,
   * instead of rendering nothing.
   *
   * Opt-in because the two behaviours suit different places. A table cell wants
   * the hole — the name beside it already says which archetype it is, and a
   * column of dolls is noise. A tier-list tile is *only* its artwork, so a hole
   * there is a tile you cannot identify and, with labels off, barely grab.
   */
  placeholder?: boolean;
}

/**
 * Renders an archetype's representative Pokémon icon(s) inline. A broken icon
 * hides itself rather than showing a placeholder, so a bad slug degrades to "no
 * icon" instead of visual noise — unless `placeholder` is set, which puts the
 * Substitute doll there instead. Renders nothing when `slugs` is empty (unless
 * `reserveSlot` or `placeholder` is set), so it can be dropped into any
 * archetype-name cell unconditionally.
 */
export function ArchetypeIcons(props: ArchetypeIconsProps) {
  const size = () => props.size ?? 22;
  const shown = () => props.slugs.slice(0, 2);
  const slotWidth = () => size() * 2 - ICON_OVERLAP;
  return (
    <Show when={props.placeholder || props.reserveSlot || shown().length > 0}>
      <span
        class={`arche-icons ${props.class ?? ''}`}
        style={props.reserveSlot ? { 'min-width': `${slotWidth()}px` } : undefined}
        aria-hidden='true'
      >
        <Show
          when={shown().length > 0}
          fallback={
            <Show when={props.placeholder}>
              <img class='arche-icon' src={SUBSTITUTE} alt='' width={size()} height={size()} decoding='async' />
            </Show>
          }
        >
          <For each={shown()}>
            {slug => <ArchetypeIcon slug={slug} size={size()} placeholder={props.placeholder} />}
          </For>
        </Show>
      </span>
    </Show>
  );
}

function ArchetypeIcon(props: { slug: string; size: number; placeholder?: boolean }) {
  // 0 = mirror, 1 = Limitless fallback, 2 = out of sources.
  const [sourceStage, setSourceStage] = createSignal(0);
  const spent = () => sourceStage() >= 2;
  const src = () => {
    if (spent()) {
      return SUBSTITUTE;
    }
    return `${sourceStage() === 0 ? ICON_BASE : ICON_FALLBACK_BASE}/${props.slug}.png`;
  };
  return (
    <Show when={!spent() || props.placeholder}>
      <img
        class='arche-icon'
        src={src()}
        alt=''
        width={props.size}
        height={props.size}
        loading='lazy'
        decoding='async'
        referrerpolicy='no-referrer'
        // Capped at 2: past that the source is our own committed file, and
        // retrying a 404 on it would only spin.
        onError={() => setSourceStage(s => Math.min(2, s + 1))}
      />
    </Show>
  );
}
