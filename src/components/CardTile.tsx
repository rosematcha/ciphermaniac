import { A } from '@solidjs/router';
import { createMemo, For } from 'solid-js';
import type { CardItem } from '../types';
import { CardImage } from './CardImage';

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
export function CardTile(props: { card: CardItem; hideEmptyBuckets?: boolean }) {
  const buckets = createMemo<{ copies: number; pct: number }[]>(() => {
    const dist = props.card.dist ?? [];
    const valid: { copies: number; pct: number }[] = [];
    for (const d of dist) {
      const copies = Number(d.copies ?? 0);
      if (!Number.isFinite(copies) || copies <= 0) {
        continue;
      }
      valid.push({ copies, pct: Number(d.percent ?? 0) });
    }

    // Always render exactly 4 bars. For "normal" cards every copy count we have
    // is 1×–4×, so this is a no-op. For Basic Energy (which can show 1×–15×
    // buckets), we show only the four MOST USED counts — keeps the histogram
    // legible at small sizes and surfaces the meaningful play patterns.
    let chosen: { copies: number; pct: number }[];
    if (valid.length <= 4) {
      chosen = [...valid];
      // In the filtered Advanced view, omit the 0% padding — the filtered
      // subset constrains exact copy counts, so showing greyed-out columns is
      // visual noise that obscures the actual distribution.
      if (!props.hideEmptyBuckets) {
        for (let i = 1; i <= 4 && chosen.length < 4; i++) {
          if (!chosen.some(b => b.copies === i)) {
            chosen.push({ copies: i, pct: 0 });
          }
        }
      }
    } else {
      chosen = [...valid].sort((a, b) => b.pct - a.pct).slice(0, 4);
    }
    // Display in ascending copy-count order so the x-axis reads left-to-right.
    chosen.sort((a, b) => a.copies - b.copies);
    return chosen;
  });

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

  const href = () =>
    props.card.set && props.card.number !== undefined ? `/cards/${props.card.set}/${props.card.number}` : '#';

  return (
    <A class='card-tile' href={href()}>
      <div class='card-tile-card'>
        <CardImage
          set={props.card.set ?? '?'}
          number={props.card.number ?? '?'}
          size='sm'
          alt={`${props.card.name} card`}
        />
        <div class='card-tile-shade' aria-hidden='true' />
        <div class='card-tile-overlay'>
          <div class='card-tile-hist' aria-hidden='true' title='Copies-per-deck distribution'>
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
                  <div class='card-tile-hist-col'>
                    <div class='card-tile-hist-fill' style={{ height: `${heightPct()}%` }} />
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
      </div>
      <div class='card-tile-meta'>
        <div class='card-tile-name-row'>
          <span class='card-tile-name'>{props.card.name}</span>
          <span class='card-tile-set'>
            {props.card.set ?? ''}
            {props.card.number !== undefined ? ` ${props.card.number}` : ''}
          </span>
        </div>
        <div class='card-tile-decks'>
          {props.card.found.toLocaleString()} / {props.card.total.toLocaleString()} decks
        </div>
      </div>
    </A>
  );
}
