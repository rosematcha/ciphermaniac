import { createEffect, createMemo, createSignal, For, on, Show } from 'solid-js';
import { buildAttempts, buildSrcset, type CardImageSize, R2_CARD_IMAGES } from './cardImage/sources';

/**
 * Our R2 bucket serves the same art re-encoded as WebP at ~25% of the PNG
 * weight (scripts/convert-card-images.ts). Gated on a `_ready` marker the
 * pipeline writes after its first successful run, so an empty or stale bucket
 * never 404-storms — until then everything goes straight to limitless.
 * The probe result is cached per session.
 */
const [r2Ready, setR2Ready] = createSignal(false);

/**
 * Kicks off the R2 readiness probe. Called once from app startup (main.tsx)
 * so it's resolved (or at least in flight) before the first `CardImage`
 * mounts — probing lazily on first mount instead delayed first paint of card
 * art on cold loads. Safe to call more than once; only fires the network
 * request when nothing is cached yet.
 */
export function probeR2Ready(): void {
  if (typeof window === 'undefined') {
    return;
  }
  let cached: string | null = null;
  try {
    cached = sessionStorage.getItem('cm:r2CardImages');
  } catch {
    /* storage unavailable */
  }
  if (cached === '1') {
    setR2Ready(true);
  } else if (cached === null) {
    fetch(`${R2_CARD_IMAGES}/_ready`)
      .then(res => {
        try {
          sessionStorage.setItem('cm:r2CardImages', res.ok ? '1' : '0');
        } catch {
          /* storage unavailable */
        }
        if (res.ok) {
          setR2Ready(true);
        }
      })
      .catch(() => {
        /* leave limitless as the source this session */
      });
  }
}

interface CardImageProps {
  set: string;
  number: string | number;
  size?: CardImageSize;
  alt?: string;
  /** Optional class added to the root element. */
  class?: string;
  /** Optional inline style on the root element. */
  style?: string;
  /** Whether to lazy-load (default true). Set false for above-the-fold images. */
  lazy?: boolean;
  /**
   * Skip the R2 WebP tier and go straight to the same-origin proxy.
   *
   * The conversion pipeline only re-encodes cards it has SEEN in a recent
   * tournament, so any printing outside that set is absent from R2 and its
   * first request 404s before the proxy retry succeeds. That is fine for a
   * report row (the card was played, so its art was converted) but not for the
   * card page's printings filmstrip, which renders every printing in a reprint
   * cluster including long-rotated ones: measured at 10 wasted round trips on
   * one card page, on a throttled connection.
   *
   * Set this where most images are expected to be outside the converted set.
   * The proxy is same-origin and edge-cached, so the only cost is the WebP
   * size saving — which is smallest at the `xs` tier these callers use.
   */
  skipR2?: boolean;
  /**
   * Rendered-width hint (standard img `sizes` syntax). When set, the browser
   * picks the cheapest sufficient tier from a srcset capped at the preferred
   * `size` — so a phone grid never downloads LG, and 1x screens drop to XS.
   * Tier widths: xs 136w (~17KB), sm 274w (~52KB), lg 460w (~118KB).
   */
  sizes?: string;
}

/** Natural pixel width of each CDN tier, for srcset w-descriptors. */

/**
 * Renders a Pokémon TCG card image. Source preference, most to least:
 *   1. Our R2 WebP bucket (when the conversion pipeline has run) — our domain,
 *      ~25% of the PNG weight.
 *   2. The same-origin `/thumbnails/{size}/{set}/{number}` Pages Function, which
 *      proxies the LimitlessTCG CDN server-side.
 *
 * Why not hotlink the CDN directly: LimitlessTCG's CDN sits behind Cloudflare
 * bot-management, which sets a `__cf_bm` cookie scoped to the public suffix
 * `digitaloceanspaces.com`. Browsers reject that cookie, and without the
 * session it establishes, concurrent image loads get 403-challenged — so a
 * page full of card art shows placeholders. The same-origin proxy sidesteps it
 * entirely (the browser talks to us; we fetch the CDN), and its responses are
 * edge-cached so it isn't a per-view Function cost. There is deliberately no
 * direct-CDN fallback tier — those requests are doomed in real browsers.
 *
 * Falls through the size tiers (lg → sm → xs) before finally rendering a
 * styled placeholder.
 */
/**
 * Warms the browser cache for one card's art at a given tier, using the same
 * source preference the component itself would pick — so the subsequent
 * `<CardImage>` render is a cache hit rather than a fresh round trip.
 *
 * Resolves once the bitmap is actually ready to paint, not merely downloaded:
 * `decode()` covers the fetch *and* the decode, which is the difference
 * between a caller being able to reveal fully-formed art and revealing an
 * empty frame that fills in a beat later (see CardHoverPreview).
 *
 * Never rejects. A 404 or decode failure resolves like any other outcome —
 * callers gate presentation on this, so a hard failure must let them proceed
 * and fall through to `CardImage`'s own retry chain rather than hang.
 * @param set - Card set code.
 * @param number - Collector number.
 * @param size - Tier to warm; must match what the eventual render requests.
 * @param skipR2 - Mirror {@link CardImageProps.skipR2} for the eventual render.
 * @returns Resolves when the art is decoded, or when it has definitively failed.
 */
export function preloadCardImage(
  set: string,
  number: string | number,
  size: CardImageSize,
  skipR2 = false
): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.resolve();
  }
  // Must mirror CardImage's source choice, or the preload warms a URL the
  // render never requests and the "cache hit" is a second round trip.
  const url = buildAttempts(set, number, size, r2Ready() && !skipR2)[0];
  if (!url) {
    return Promise.resolve();
  }
  // Deliberately never attached to the document; assigning .src starts the
  // fetch and populates the same HTTP + decoded-bitmap caches the real
  // element will hit.
  const img = new Image();
  img.src = url;
  return img.decode().catch(() => undefined);
}

export function CardImage(props: CardImageProps) {
  // Capture the R2 decision once per instance: an async probe flipping the
  // global signal mid-session must not re-source already-rendered images
  // (double download + flicker). Future mounts pick up the new value.
  //
  // `skipR2` DOES track, unlike the probe: it changes with the previewed
  // printing on the card page, and that already re-sources the image (set and
  // number change with it), so honoring it costs no extra churn — whereas
  // ignoring it would 404 the hero at `lg` on every hover over an unconverted
  // print.
  // eslint-disable-next-line solid/reactivity -- the probe specifically must not track
  const r2Probed = r2Ready();
  const useR2 = createMemo(() => r2Probed && props.skipR2 !== true);
  const attempts = createMemo(() => buildAttempts(props.set, props.number, props.size ?? 'sm', useR2()));
  const [attemptIndex, setAttemptIndex] = createSignal(0);
  const [errored, setErrored] = createSignal(false);
  const [loaded, setLoaded] = createSignal(false);

  // A reused instance must not carry card A's retry/error state over to card B.
  createEffect(
    on(
      () => [props.set, props.number],
      () => {
        setAttemptIndex(0);
        setErrored(false);
        setLoaded(false);
      },
      { defer: true }
    )
  );

  const src = () => attempts()[attemptIndex()];
  const alt = () => props.alt ?? `${props.set}/${props.number} card image`;

  function onError() {
    if (attemptIndex() < attempts().length - 1) {
      setAttemptIndex(attemptIndex() + 1);
    } else {
      setErrored(true);
    }
  }

  return (
    <Show
      when={!errored()}
      fallback={
        <div class={`card-image-fallback ${props.class ?? ''}`} style={props.style} role='img' aria-label={alt()}>
          <div class='card-image-fallback-inner'>
            <div class='set'>{String(props.set).toUpperCase()}</div>
            <div class='number'>#{String(props.number)}</div>
          </div>
        </div>
      }
    >
      <img
        src={src()}
        srcset={
          props.sizes && attemptIndex() === 0
            ? buildSrcset(props.set, props.number, props.size ?? 'sm', useR2())
            : undefined
        }
        sizes={props.sizes && attemptIndex() === 0 ? props.sizes : undefined}
        alt={alt()}
        width='274'
        height='381'
        loading={props.lazy === false ? undefined : 'lazy'}
        decoding='async'
        class={`card-img ${props.class ?? ''}`}
        style={props.style}
        // The attribute is the loading contract callers style against: absent
        // until the bitmap has painted, so a pending image can carry a
        // placeholder rather than sitting transparent (see `.tl-item`).
        data-loaded={loaded() ? '' : undefined}
        onLoad={() => setLoaded(true)}
        onError={onError}
        referrerpolicy='no-referrer'
      />
    </Show>
  );
}

/**
 * Stack of up to three card images, fanned slightly, used for archetype thumbnails.
 * Accepts a thumbnails array in the format `["SET/NUMBER", "SET/NUMBER", ...]`.
 */
export function CardStack(props: { thumbnails: string[]; size?: CardImageSize; lazy?: boolean }) {
  const cards = createMemo(() =>
    props.thumbnails
      .map(t => {
        const [set, number] = t.split('/');
        if (!set || number === undefined) {
          return null;
        }
        return { set, number };
      })
      .filter((c): c is { set: string; number: string } => c !== null)
      .slice(0, 3)
  );

  return (
    <div
      class='card-stack'
      classList={{
        'card-stack-1': cards().length === 1,
        'card-stack-2': cards().length === 2,
        'card-stack-3': cards().length >= 3
      }}
    >
      <Show when={cards().length === 0}>
        <div class='card-stack-empty'>—</div>
      </Show>
      <For each={cards()}>
        {c => (
          <div class='card-stack-slot'>
            <CardImage set={c.set} number={c.number} size={props.size ?? 'xs'} lazy={props.lazy} />
          </div>
        )}
      </For>
    </div>
  );
}
