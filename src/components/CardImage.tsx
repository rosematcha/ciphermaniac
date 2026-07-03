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
 * Renders a Pokémon TCG card image directly from the LimitlessTCG CDN.
 *
 * URL format: `https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/{SET}/{SET}_{NUMBER}_R_EN_{SIZE}.png`
 *
 * Images are fetched browser-to-CDN — no Cloudflare Worker involvement, so we
 * don't pay Function invocations for visual media. `<img>` tags don't need CORS,
 * so cross-origin display works without any header dance.
 *
 * Falls back through the size tiers (lg → sm → xs) and number formats
 * (as-given → zero-padded) before finally rendering a styled placeholder.
 */
const LIMITLESS_CDN = 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci';

function tierUrl(setU: string, num: string, size: CardImageSize): string {
  return `${LIMITLESS_CDN}/${setU}/${setU}_${num}_R_EN_${size.toUpperCase()}.png`;
}

/**
 * srcset over every tier up to (and including) the preferred size, using the
 * padded number form. Only used for the first attempt — if anything 404s we
 * fall back to the plain single-src retry chain, which stays authoritative.
 */
function buildSrcset(set: string, number: string | number, preferredSize: CardImageSize): string {
  const setU = String(set).toUpperCase();
  const stripped = String(number).replace(/^0+/, '') || '0';
  const parts = stripped.match(/^(\d+)([A-Za-z]*)$/);
  const num = parts ? `${parts[1].padStart(3, '0')}${parts[2] ?? ''}` : stripped;
  const tiers: CardImageSize[] = preferredSize === 'lg' ? ['xs', 'sm', 'lg'] : ['xs', 'sm'];
  return tiers.map(t => `${tierUrl(setU, num, t)} ${TIER_WIDTH[t]}w`).join(', ');
}

function buildAttempts(set: string, number: string | number, preferredSize: CardImageSize): string[] {
  const setU = String(set).toUpperCase();
  const numStr = String(number);
  const stripped = numStr.replace(/^0+/, '') || '0';
  const parts = stripped.match(/^(\d+)([A-Za-z]*)$/);

  // Build candidate number forms. Limitless's CDN consistently uses 3-digit
  // zero-padded numbers (e.g. PRE_037, not PRE_37), so prefer the padded form
  // — it's a first-try hit for older sets and a no-op for 3+ digit modern sets.
  const numberForms: string[] = [];
  if (parts) {
    const [, digits, suffix = ''] = parts;
    const padded = `${digits.padStart(3, '0')}${suffix}`;
    numberForms.push(padded);
  }
  if (!numberForms.includes(stripped)) {
    numberForms.push(stripped);
  }
  if (!numberForms.includes(numStr)) {
    numberForms.push(numStr);
  }

  // Size fallback chain: lg → sm → xs.
  const sizeChain: CardImageSize[] =
    preferredSize === 'lg' ? ['lg', 'sm', 'xs'] : preferredSize === 'sm' ? ['sm', 'xs'] : ['xs'];

  // Cross product, deduped. Try the preferred size with all number variants
  // before stepping down to the next size — small sets cost the most attempts
  // for the rare card whose ID needs zero-padding.
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const size of sizeChain) {
    for (const num of numberForms) {
      const url = tierUrl(setU, num, size);
      if (!seen.has(url)) {
        seen.add(url);
        urls.push(url);
      }
    }
  }
  return urls;
}

export function CardImage(props: CardImageProps) {
  const attempts = createMemo(() => buildAttempts(props.set, props.number, props.size ?? 'sm'));
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
          props.sizes && attemptIndex() === 0 ? buildSrcset(props.set, props.number, props.size ?? 'sm') : undefined
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
