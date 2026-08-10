import { createSignal, type JSX, onCleanup, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { CardImage } from './CardImage';
import { placeHoverPreview, type PreviewPlacement } from '../utils/hoverPreviewPlacement';

/** Rendered width of the preview art, in px. Height follows the card aspect. */
const PREVIEW_WIDTH = 200;
/** Standard Pokémon card proportions (63×88mm). */
const CARD_ASPECT = 63 / 88;
const PREVIEW_HEIGHT = Math.round(PREVIEW_WIDTH / CARD_ASPECT);
/**
 * Delay before a preview appears. Long enough that sweeping the pointer down a
 * 60-card list doesn't strobe previews, short enough to feel immediate when
 * you actually stop on a line.
 */
const OPEN_DELAY_MS = 130;

/** True on pointer devices that genuinely hover — never on touch. */
function hoverCapable(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(hover: hover) and (pointer: fine)').matches === true;
}

interface CardHoverPreviewProps {
  set: string;
  number: string;
  children: JSX.Element;
}

/**
 * Wraps a decklist line so hovering (or keyboard-focusing) it floats that
 * card's art above the text.
 *
 * Portalled to <body> with `position: fixed`: the decklist lives inside
 * `.table-wrap`, which clips its overflow, so an in-flow absolute layer would
 * be cut off at the table edge. The layer is `pointer-events: none` and
 * `aria-hidden` — it's a visual affordance over a link that already names the
 * card, so it must never swallow the click or double-announce to a screen
 * reader.
 *
 * Nothing renders on touch devices, where "hover" resolves to a tap that
 * should just follow the link.
 */
export function CardHoverPreview(props: CardHoverPreviewProps) {
  const [placement, setPlacement] = createSignal<PreviewPlacement | null>(null);
  let anchorRef: HTMLSpanElement | undefined;
  let openTimer: number | undefined;

  // Any scroll or resize moves the anchor out from under a fixed-position
  // layer, so drop the preview rather than let it drift off its row. Bound
  // only while one is open: a 60-card list would otherwise carry 60 idle
  // listeners, and an expanded profile several times that.
  const onViewportChange = () => close();
  let listening = false;
  const bindViewportListeners = (on: boolean) => {
    if (on === listening) {
      return;
    }
    listening = on;
    if (on) {
      window.addEventListener('scroll', onViewportChange, true);
      window.addEventListener('resize', onViewportChange);
    } else {
      window.removeEventListener('scroll', onViewportChange, true);
      window.removeEventListener('resize', onViewportChange);
    }
  };

  function close() {
    if (openTimer !== undefined) {
      window.clearTimeout(openTimer);
      openTimer = undefined;
    }
    bindViewportListeners(false);
    setPlacement(null);
  }

  const openNow = () => {
    if (!anchorRef) {
      return;
    }
    const rect = anchorRef.getBoundingClientRect();
    setPlacement(
      placeHoverPreview(
        rect,
        { width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT },
        { width: window.innerWidth, height: window.innerHeight }
      )
    );
    bindViewportListeners(true);
  };

  const scheduleOpen = () => {
    if (!hoverCapable() || openTimer !== undefined || placement()) {
      return;
    }
    openTimer = window.setTimeout(() => {
      openTimer = undefined;
      openNow();
    }, OPEN_DELAY_MS);
  };

  onCleanup(close);

  return (
    <span
      ref={anchorRef}
      class='card-hover-anchor'
      onMouseEnter={scheduleOpen}
      onMouseLeave={close}
      // Keyboard parity: tabbing through the decklist previews too. Focus is
      // instant — someone who tabbed here already committed to this line.
      onFocusIn={() => {
        if (hoverCapable()) {
          openNow();
        }
      }}
      onFocusOut={close}
    >
      {props.children}
      <Show when={placement()}>
        {place => (
          <Portal>
            <div
              class='card-hover-preview'
              aria-hidden='true'
              style={{
                left: `${place().left}px`,
                top: `${place().top}px`,
                width: `${PREVIEW_WIDTH}px`
              }}
            >
              <CardImage set={props.set} number={props.number} size='sm' alt='' lazy={false} />
            </div>
          </Portal>
        )}
      </Show>
    </span>
  );
}
