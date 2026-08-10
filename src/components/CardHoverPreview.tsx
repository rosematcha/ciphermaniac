import { createSignal, type JSX, onCleanup, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { CardImage, preloadCardImage } from './CardImage';
import { placeHoverPreview, type PreviewPlacement } from '../utils/hoverPreviewPlacement';

/**
 * Art tier for the preview. `xs` (136×190, ~8KB) rather than `sm` (~26KB):
 * this is a recognition affordance, not a reading surface — nobody reads rules
 * text at this size — and a third of the bytes is the difference between the
 * art being there when the preview opens and arriving after it.
 */
const PREVIEW_TIER = 'xs';
/**
 * Rendered width of the preview art, in px. Held near the `xs` natural width
 * (136px) so the tier isn't upscaled into mush. Height follows the card aspect.
 */
const PREVIEW_WIDTH = 168;
/** Standard Pokémon card proportions (63×88mm). */
const CARD_ASPECT = 63 / 88;
const PREVIEW_HEIGHT = Math.round(PREVIEW_WIDTH / CARD_ASPECT);
/**
 * Dwell before a preview may appear. Long enough that sweeping the pointer
 * down a 60-card list doesn't strobe previews, short enough to feel immediate
 * when you actually stop on a line.
 */
const OPEN_DELAY_MS = 130;
/**
 * Hard cap on waiting for art. Past this we reveal the frame anyway and let
 * the image land inside it — a slow or broken image must not mean hovering
 * does nothing at all.
 */
const ART_WAIT_CAP_MS = 500;

/** True on pointer devices that genuinely hover — never on touch. */
function hoverCapable(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(hover: hover) and (pointer: fine)').matches === true;
}

interface CardHoverPreviewProps {
  set: string;
  /** Collector number; numeric forms are accepted since report data carries both. */
  number: string | number;
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
  let capTimer: number | undefined;
  /** An open is scheduled or showing; cleared by close() to cancel a pending reveal. */
  let pending = false;

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
    pending = false;
    for (const timer of [openTimer, capTimer]) {
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    }
    openTimer = undefined;
    capTimer = undefined;
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

  /**
   * Reveal only once the art is decoded, so the preview appears fully formed.
   * Mounting on a bare timer instead meant the empty frame faded in first and
   * the image popped in a beat later — read as a flicker on any cold hover.
   *
   * Waits on the dwell and the artwork concurrently (the fetch starts now,
   * not when the frame mounts), so the two costs overlap instead of stacking.
   */
  const scheduleOpen = (dwellMs: number) => {
    if (!hoverCapable() || pending || placement()) {
      return;
    }
    pending = true;
    const artReady = preloadCardImage(props.set, props.number, PREVIEW_TIER);
    const dwell = new Promise<void>(resolve => {
      openTimer = window.setTimeout(resolve, dwellMs);
    });
    const capped = new Promise<void>(resolve => {
      capTimer = window.setTimeout(resolve, ART_WAIT_CAP_MS);
    });
    void Promise.all([dwell, Promise.race([artReady, capped])]).then(() => {
      // The pointer may have left while we waited; close() clears `pending`.
      if (pending) {
        openNow();
      }
    });
  };

  onCleanup(close);

  return (
    <span
      ref={anchorRef}
      class='card-hover-anchor'
      onMouseEnter={() => scheduleOpen(OPEN_DELAY_MS)}
      onMouseLeave={close}
      // Keyboard parity: tabbing through the decklist previews too, with no
      // dwell — someone who tabbed here already committed to this line — but
      // still gated on decoded art so it reveals the same way a hover does.
      onFocusIn={() => scheduleOpen(0)}
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
              <CardImage set={props.set} number={props.number} size={PREVIEW_TIER} alt='' lazy={false} />
            </div>
          </Portal>
        )}
      </Show>
    </span>
  );
}
