/**
 * Balatro's "juice", baked into Web Animations keyframes.
 *
 * The game wobbles a card by driving a damped sine into its target scale and
 * rotation (`Moveable:juice_up` / `move_juice`), then lets the drawn transform
 * chase that target through an exponential spring (`move_scale` / `move_r`).
 * The spring is what makes it feel good: it overshoots a pop-in and lags the
 * wobble a frame or two. Here the whole thing is simulated once, up front, at
 * 60fps and handed to `element.animate`, so the browser runs it on the
 * compositor and a case's worth of tiles costs no per-frame script.
 */

const FPS = 60;
const DT = 1 / FPS;
/** `juice.end_time - juice.start_time`. */
const JUICE_SECONDS = 0.4;
/** `G.exp_times.scale` and `.r` at a steady 60fps. */
const SPRING_SCALE = Math.exp(-60 * DT);
const SPRING_R = Math.exp(-190 * DT);
/** A pop-in's spring needs a few frames past the wobble to settle. */
const POP_SECONDS = 0.5;

export interface JuiceOptions {
  /** `scale_amt`: how far the wobble swings the scale. Balatro's card default is 0.11. */
  scale: number;
  /** Peak rotation in degrees; the sign picks the direction it kicks first. */
  rotation: number;
  /** Grow in from nothing (a new stack) rather than bump in place (another copy). */
  pop: boolean;
}

const paints = new Set<() => void>();
let paintPending = false;

/** Start tile animations together after the grid's DOM updates have finished. */
export function queueTilePaint(paint: () => void): () => void {
  paints.add(paint);
  if (!paintPending) {
    paintPending = true;
    requestAnimationFrame(() => {
      paintPending = false;
      const pending = [...paints];
      paints.clear();
      pending.forEach(callback => callback());
    });
  }
  return () => {
    paints.delete(paint);
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Keyframes plus the duration they span, evenly spaced one frame apart. */
export function juiceFrames(options: JuiceOptions): { frames: Keyframe[]; duration: number } {
  const seconds = options.pop ? POP_SECONDS : JUICE_SECONDS;
  const count = Math.round(seconds * FPS);
  // juice_up kicks the drawn scale down before the wobble starts; a pop starts from nothing.
  let scale = options.pop ? 0 : 1 - 0.6 * options.scale;
  let scaleVelocity = 0;
  let rotation = 0;
  let rotationVelocity = 0;
  const frames: Keyframe[] = [];
  for (let index = 0; index <= count; index += 1) {
    const t = index * DT;
    const left = Math.max(0, 1 - t / JUICE_SECONDS);
    frames.push({
      transform: `scale(${round(scale)}) rotate(${round(rotation)}deg)`,
      opacity: options.pop ? Math.min(1, index / 4) : 1
    });
    const targetScale = 1 + options.scale * Math.sin(50.8 * t) * left ** 3;
    const targetRotation = options.rotation * Math.sin(40.8 * t) * left ** 2;
    scaleVelocity = SPRING_SCALE * scaleVelocity + (1 - SPRING_SCALE) * (targetScale - scale);
    scale += scaleVelocity;
    rotationVelocity = SPRING_R * rotationVelocity + (1 - SPRING_R) * (targetRotation - rotation);
    rotation += rotationVelocity;
  }
  // Land exactly at rest, so the element hands back to its own styles without a jump.
  frames[frames.length - 1] = { transform: 'none', opacity: 1 };
  return { frames, duration: seconds * 1000 };
}

/** Delay between neighbouring tiles, and the longest any tile waits. */
const STAGGER_MS = 28;
const STAGGER_CAP_MS = 560;

export function staggerDelay(index: number): number {
  return Math.min(index * STAGGER_MS, STAGGER_CAP_MS);
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Nobody sees motion they asked not to get, or motion inside a closed drawer. */
function canAnimate(element: Element): boolean {
  return typeof element.animate === 'function' && !prefersReducedMotion() && !element.closest('details:not([open])');
}

/** Juice an element, after `delay` milliseconds. */
export function juice(element: Element, options: JuiceOptions, delay = 0): void {
  if (!canAnimate(element)) {
    return;
  }
  const { frames, duration } = juiceFrames(options);
  // A pop holds its first frame through the stagger; a bump must not, or it would cut short whatever runs before it.
  element.animate(frames, { duration, delay, fill: options.pop ? 'backwards' : 'none' });
}

/** `set_edition` juices a card 0.2s after it's set; a pop needs a little longer to land first. */
const CALLOUT_AFTER_MS = 320;
const SHEEN_MS = 700;
const SHEEN = 'linear-gradient(115deg, transparent 40%, rgb(255 255 255 / 0.6) 50%, transparent 60%)';

/**
 * Call out a chase pull the way Balatro calls out a foil, holo, or polychrome
 * card: once it has landed, `juice_up(1, 0.5)`, a kick about three times the
 * usual, and one light sweep across the art where the game plays the
 * edition's sound. The sweep paints the tile's `::after`.
 */
export function callout(element: Element, delay = 0): void {
  if (!canAnimate(element)) {
    return;
  }
  const start = delay + CALLOUT_AFTER_MS;
  const { frames, duration } = juiceFrames({ scale: 0.3, rotation: kick(8), pop: false });
  element.animate(frames, { duration, delay: start });
  element.animate(
    {
      backgroundImage: [SHEEN, SHEEN],
      backgroundSize: ['300% 100%', '300% 100%'],
      backgroundRepeat: ['no-repeat', 'no-repeat'],
      backgroundPosition: ['130% 0', '-30% 0'],
      opacity: [0, 1, 0]
    },
    { duration: SHEEN_MS, delay: start, easing: 'ease-out', pseudoElement: '::after' }
  );
}

/** How long a rip's delta holds before it fades, per `attention_text`. */
const ATTENTION_HOLD_MS = 700;
const ATTENTION_FADE_MS = 300;

/**
 * Pop a rip's delta in beside its figure, hold it, and fade it out, the way
 * `ease_dollars` flashes "+$5" over the money readout. Under reduced motion it
 * simply stays until the next rip replaces it.
 */
export function attention(element: Element): void {
  if (!canAnimate(element)) {
    return;
  }
  const { frames, duration } = juiceFrames({ scale: 0.2, rotation: kick(6), pop: true });
  element.animate(frames, { duration, fill: 'backwards' });
  element.animate(
    { opacity: [1, 0] },
    { duration: ATTENTION_FADE_MS, delay: duration + ATTENTION_HOLD_MS, fill: 'forwards' }
  );
}

/** A coin flip for which way a wobble kicks, as `juice_up` does. */
export function kick(degrees: number): number {
  return Math.random() > 0.5 ? degrees : -degrees;
}
