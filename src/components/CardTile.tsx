import { A } from '@solidjs/router';
import { createMemo, For, Show } from 'solid-js';
import type { CardItem } from '../types';
import { CardImage } from './CardImage';
import { prefetchCardPage } from '../lib/prefetch';
import { copyBucketLabel } from '../lib/format';

/**
 * Grid cell for the /cards page.
 *
 * Visual structure (from top to bottom):
 *   ┌──────────────────────┐
 *   │   card image (5:7)   │
 *   │  ┌──┐                │
 *   │  │  │ ┌──┐           │  ← copy-count histogram overlay,
 *   │  │  │ │  │ ┌──┐ ┌──┐ │     bars filling the bottom ~55% of the card
 *   │  │ 1│ │ 2│ │ 3│ │ 4│ │     (each bar's height = % of decks playing N copies)
 *   │ ┌──────────┐ 91.8%   │  ← total-usage bar, peach fill = inclusion %
 *   └──────────────────────┘
 *   Name        SET 123
 *   2,982 / 7,997 decks
 *
 * The whole tile is a single link to the card detail page.
 */
interface CopyBucket {
  copies: number;
  pct: number;
  decks?: number;
}

/** Copy-count buckets with a positive copy count and share. */
function validBuckets(card: CardItem): CopyBucket[] {
  const valid: CopyBucket[] = [];
  for (const d of card.dist ?? []) {
    const copies = Number(d.copies ?? 0);
    const pct = Number(d.percent ?? 0);
    if (Number.isFinite(copies) && copies > 0 && pct > 0) {
      valid.push({ copies, pct, decks: d.players });
    }
  }
  return valid;
}

/**
 * Always render exactly 4 bars. For "normal" cards every copy count we have
 * is 1×–4×, so this is a no-op. For Basic Energy (which can show 1×–15×
 * buckets), we show only the four MOST USED counts — keeps the histogram
 * legible at small sizes and surfaces the meaningful play patterns.
 *
 * In the filtered Advanced view (`pad` false), omit the 0% padding — the
 * filtered subset constrains exact copy counts, so showing greyed-out columns
 * is visual noise that obscures the actual distribution.
 */
function histogramBuckets(valid: CopyBucket[], pad: boolean): CopyBucket[] {
  const chosen = valid.length <= 4 ? [...valid] : [...valid].sort((a, b) => b.pct - a.pct).slice(0, 4);
  for (let i = 1; i <= 4 && chosen.length < 4; i++) {
    if (pad && !chosen.some(b => b.copies === i)) {
      chosen.push({ copies: i, pct: 0 });
    }
  }
  // Display in ascending copy-count order so the x-axis reads left-to-right.
  return chosen.sort((a, b) => a.copies - b.copies);
}

/** The copy-count histogram and usage bar drawn over a card's art. */
export function CardTileOverlay(props: { card: CardItem; hideEmptyBuckets?: boolean }) {
  const buckets = createMemo(() => histogramBuckets(validBuckets(props.card), !props.hideEmptyBuckets));

  // Scale the bars to the largest single-bucket value so even small-percentage
  // bars stay visible. (If every card scaled to 0–100%, low-inclusion cards
  // would have invisible bars.)
  const peakBucketPct = createMemo(() => {
    const b = buckets();
    let max = 0;
    for (const e of b) {
      if (e.pct > max) {
        max = e.pct;
      }
    }
    return max;
  });

  // Accessible summary + tooltip for the copy-count histogram. Reads like
  // "1 copy: 12%, 2 copies: 60%, ..." so screen readers (and hover) get the
  // real distribution instead of a generic label.
  const bucketText = (b: CopyBucket) => copyBucketLabel(b.copies, b.pct, b.decks);
  const histSummary = createMemo(() => {
    const b = buckets();
    if (b.length === 0) {
      return 'No copy-count data.';
    }
    return `Copies per deck — ${b.map(bucketText).join(', ')}`;
  });

  return (
    <div class='card-tile-overlay'>
      <div class='card-tile-hist' role='img' aria-label={histSummary()} title={histSummary()}>
        <For each={buckets()}>
          {bucket => {
            const heightPct = () => {
              const peak = peakBucketPct();
              if (peak <= 0) {
                return 0;
              }
              // Map to 6–100% range so a tiny non-zero bar is still visible.
              return Math.max(bucket.pct > 0 ? 8 : 0, (bucket.pct / peak) * 100);
            };
            return (
              <div class='card-tile-hist-col' title={bucketText(bucket)}>
                <Show when={bucket.pct > 0}>
                  <div class='card-tile-hist-fill' style={{ height: `${heightPct()}%` }} />
                </Show>
                <span class='card-tile-hist-label'>{bucket.copies}</span>
              </div>
            );
          }}
        </For>
      </div>
      <div
        class='card-tile-usage'
        title={`Found in ${props.card.found.toLocaleString()} of ${props.card.total.toLocaleString()} decks`}
      >
        <div class='card-tile-usage-fill' style={{ width: `${Math.min(100, props.card.pct)}%` }} />
        <span class='card-tile-usage-pct'>{props.card.pct.toFixed(1)}%</span>
      </div>
    </div>
  );
}

/** A card's page, or `#` when the report row has no printing. */
export function cardHref(card: CardItem): string {
  return card.set && card.number !== undefined ? `/cards/${card.set}/${card.number}` : '#';
}

export function CardTile(props: { card: CardItem; hideEmptyBuckets?: boolean; eagerImage?: boolean }) {
  return (
    <A class='card-tile' href={cardHref(props.card)} onMouseEnter={prefetchCardPage} onFocus={prefetchCardPage}>
      <div class='card-tile-card'>
        <CardImage
          set={props.card.set ?? '?'}
          number={props.card.number ?? '?'}
          size='sm'
          sizes='(max-width: 640px) 30vw, 164px'
          alt={`${props.card.name} card`}
          lazy={props.eagerImage ? false : undefined}
        />
        <div class='card-tile-shade' aria-hidden='true' />
        <CardTileOverlay card={props.card} hideEmptyBuckets={props.hideEmptyBuckets} />
      </div>
      <div class='card-tile-meta'>
        <div class='card-tile-name-row'>
          <span class='card-tile-name'>{props.card.name}</span>
          <CardTileSet card={props.card} />
        </div>
        <div class='card-tile-decks'>
          {props.card.found.toLocaleString()} / {props.card.total.toLocaleString()} decks
        </div>
      </div>
    </A>
  );
}

/** The set code and number beside a tile's name. */
export function CardTileSet(props: { card: CardItem }) {
  return (
    <span class='card-tile-set'>
      {props.card.set ?? ''}
      {props.card.number !== undefined ? ` ${props.card.number}` : ''}
    </span>
  );
}
