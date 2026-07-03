import { createMemo, createSignal, For, Show } from 'solid-js';

type CardImageSize = 'xs' | 'sm' | 'lg';

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
   * Rendered-width hint (standard img `sizes` syntax). When set, the browser
   * picks the cheapest sufficient tier from a srcset capped at the preferred
   * `size` — so a phone grid never downloads LG, and 1x screens drop to XS.
   * Tier widths: xs 136w (~17KB), sm 274w (~52KB), lg 460w (~118KB).
   */
  sizes?: string;
}

/** Natural pixel width of each CDN tier, for srcset w-descriptors. */
const TIER_WIDTH: Record<CardImageSize, number> = { xs: 136, sm: 274, lg: 460 };

/**
 * Renders a Pokémon TCG card image. Source preference, most to least:
 *   1. Our R2 WebP bucket (when the conversion pipeline has run) — our domain,
 *      ~25% of the PNG weight.
 *   2. The same-origin `/thumbnails/{size}/{set}/{number}` Pages Function, which
 *      proxies the LimitlessTCG CDN server-side.
 *   3. Direct LimitlessTCG CDN — last-resort only.
 *
 * Why not hotlink the CDN directly: LimitlessTCG's CDN sits behind Cloudflare
 * bot-management, which sets a `__cf_bm` cookie scoped to the public suffix
 * `digitaloceanspaces.com`. Browsers reject that cookie, and without the
 * session it establishes, concurrent image loads get 403-challenged — so a
 * page full of card art shows placeholders. The same-origin proxy sidesteps it
 * entirely (the browser talks to us; we fetch the CDN), and its responses are
 * edge-cached so it isn't a per-view Function cost.
 *
 * Falls through the size tiers (lg → sm → xs) and number formats
 * (zero-padded → as-given) before finally rendering a styled placeholder.
 */
const LIMITLESS_CDN = 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci';
const R2_CARD_IMAGES = 'https://r2.ciphermaniac.com/card-images';
const THUMBNAILS_PROXY = '/thumbnails';

/**
 * Our R2 bucket serves the same art re-encoded as WebP at ~25% of the PNG
 * weight (scripts/convert-card-images.ts). Gated on a `_ready` marker the
 * pipeline writes after its first successful run, so an empty or stale bucket
 * never 404-storms — until then everything goes straight to limitless.
 * The probe result is cached per session.
 */
const [r2Ready, setR2Ready] = createSignal(false);
if (typeof window !== 'undefined') {
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

function tierUrl(setU: string, num: string, size: CardImageSize): string {
  return `${LIMITLESS_CDN}/${setU}/${setU}_${num}_R_EN_${size.toUpperCase()}.png`;
}

function r2TierUrl(setU: string, num: string, size: CardImageSize): string {
  return `${R2_CARD_IMAGES}/${setU}/${setU}_${num}_R_EN_${size.toUpperCase()}.webp`;
}

/** Same-origin proxy URL. The Function normalizes the number server-side. */
function thumbTierUrl(setU: string, num: string, size: CardImageSize): string {
  return `${THUMBNAILS_PROXY}/${size}/${setU}/${num}`;
}

/**
 * srcset over every tier up to (and including) the preferred size, using the
 * padded number form. Only used for the first attempt — if anything 404s we
 * fall back to the plain single-src retry chain, which stays authoritative.
 */
function buildSrcset(set: string, number: string | number, preferredSize: CardImageSize, useR2: boolean): string {
  const setU = String(set).toUpperCase();
  const stripped = String(number).replace(/^0+/, '') || '0';
  const parts = stripped.match(/^(\d+)([A-Za-z]*)$/);
  const num = parts ? `${parts[1].padStart(3, '0')}${parts[2] ?? ''}` : stripped;
  const tiers: CardImageSize[] = preferredSize === 'lg' ? ['xs', 'sm', 'lg'] : ['xs', 'sm'];
  // R2 WebP when ready, else the same-origin proxy — never hotlink the CDN in
  // srcset, since that's the path the browser bot-blocks.
  const urlFor = useR2 ? r2TierUrl : thumbTierUrl;
  return tiers.map(t => `${urlFor(setU, num, t)} ${TIER_WIDTH[t]}w`).join(', ');
}

function buildAttempts(set: string, number: string | number, preferredSize: CardImageSize, useR2: boolean): string[] {
  const setU = String(set).toUpperCase();
  const numStr = String(number);
  const stripped = numStr.replace(/^0+/, '') || '0';
  const parts = stripped.match(/^(\d+)([A-Za-z]*)$/);
  // Limitless's CDN uses 3-digit zero-padded numbers (PRE_037, not PRE_37).
  const padded = parts ? `${parts[1].padStart(3, '0')}${parts[2] ?? ''}` : stripped;

  // Size fallback chain: lg → sm → xs.
  const sizeChain: CardImageSize[] =
    preferredSize === 'lg' ? ['lg', 'sm', 'xs'] : preferredSize === 'sm' ? ['sm', 'xs'] : ['xs'];

  const seen = new Set<string>();
  const urls: string[] = [];
  const push = (url: string) => {
    if (!seen.has(url)) {
      seen.add(url);
      urls.push(url);
    }
  };

  // 1. R2 WebP (preferred tier) when the pipeline has run — lightest, our domain.
  if (useR2) {
    push(r2TierUrl(setU, padded, preferredSize));
  }
  // 2. Same-origin proxy for each tier. This is the reliable browser-facing
  //    source: it dodges the CDN's browser-rejected bot cookie, and the proxy
  //    normalizes the number itself, so one URL per tier suffices.
  for (const size of sizeChain) {
    push(thumbTierUrl(setU, padded, size));
  }
  // 3. Direct CDN as a last resort (padded then unpadded), in case the proxy
  //    Function is unavailable.
  for (const size of sizeChain) {
    push(tierUrl(setU, padded, size));
    if (stripped !== padded) {
      push(tierUrl(setU, stripped, size));
    }
  }
  return urls;
}

export function CardImage(props: CardImageProps) {
  const attempts = createMemo(() => buildAttempts(props.set, props.number, props.size ?? 'sm', r2Ready()));
  const [attemptIndex, setAttemptIndex] = createSignal(0);
  const [errored, setErrored] = createSignal(false);

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
        <div class={`card-image-fallback ${props.class ?? ''}`} style={props.style} aria-label={alt()}>
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
            ? buildSrcset(props.set, props.number, props.size ?? 'sm', r2Ready())
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
export function CardStack(props: { thumbnails: string[]; size?: CardImageSize }) {
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
        {(c, i) => (
          <div class='card-stack-slot' style={{ '--i': i() }}>
            <CardImage set={c.set} number={c.number} size={props.size ?? 'xs'} />
          </div>
        )}
      </For>
    </div>
  );
}
