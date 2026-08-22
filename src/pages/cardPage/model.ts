/**
 * The card page's calculations, as pure functions.
 *
 * CardPage is an orchestrator over half a dozen independent fetches — master
 * report, rotation snapshot, prices, price history, archetype index, card
 * usage, day-2 conversion — and the logic that joins them was spread through
 * its reactive memos, where it could only be exercised by driving a browser.
 *
 * The joins are the interesting part, because most of them are cluster-aware
 * for a non-obvious reason: a rebaked historical event keys its rows by that
 * event's ROLLING canonical print (D17), which is a different UID from today's
 * global canonical for the same card. A direct match silently finds nothing on
 * exactly the events that have been reprocessed, so each lookup here tries the
 * card's own UID, then its global canonical, then a set/number fallback.
 * @module src/pages/cardPage/model
 */

import { cardUidOrName } from '../../../shared/data/cardIdentity';
import type { SynonymDatabase } from '../../../shared/synonyms';
import { findByClusterUid, normalizeCardNumberKey } from '../../lib/data';
import { itemUid } from '../../lib/data/compat';
import { cardUsageForCard, type CardUsagePayload } from '../../lib/data/cards';
import type { Day2CardStat } from '../../lib/data/events';
import type { PricePoint, PricingEntry } from '../../lib/data/prices';
import { snapshotSourceKey } from '../../lib/data/paths';
import { ONLINE_META_NAME } from '../../lib/constants';
import { nameFromTournamentKey } from '../../lib/format';
import type { ArchetypeIndexEntry, ArchetypeReport, CardItem } from '../../types';

/** One archetype's usage of the card, as the table renders it. */
export interface ArchetypeUsageRow {
  entry: ArchetypeIndexEntry;
  item: CardItem;
  /** Only `deckTotal` is read; the fan-out path passes a full ArchetypeReport (structurally compatible). */
  report: { deckTotal: number };
}

/** A printing selected in the printings strip, by hover or pin. */
export interface SelectedPrint {
  uid: string;
  set: string;
  number: string | number;
  price?: number | null;
}

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

/**
 * The tournament downstream fetches should target.
 *
 * When the page is rendering snapshot data, point the archetype fan-out at the
 * same snapshot so "Where it's played" shows historical archetypes rather than
 * today's.
 * @param hasLiveCard - Whether the live report had this card
 * @param tournament - The selected tournament key
 * @param snapshotDate - Rotation snapshot date, when one applies
 * @returns The tournament key to fetch with
 */
export function effectiveTournament(hasLiveCard: boolean, tournament: string, snapshotDate: string | null): string {
  if (hasLiveCard) {
    return tournament;
  }
  return snapshotDate ? snapshotSourceKey(snapshotDate) : tournament;
}

/**
 * Whether day-2 conversion can be computed for a scope.
 *
 * Skipped where there is no single day-2 cut: the online meta is a rolling
 * 14-day window, and pre-rotation snapshots are frozen reports with no decks
 * carrying a `madePhase2` flag. For those the request has nothing to read, so
 * the page does not fire it at all.
 * @param tournament - The effective tournament key
 * @returns Whether to fetch conversion stats
 */
export function supportsConversion(tournament: string): boolean {
  return Boolean(tournament) && tournament !== ONLINE_META_NAME && !tournament.startsWith('snapshot:');
}

/**
 * Human-readable label for a `YYYY-MM-DD` snapshot date.
 * @param raw - The snapshot date, or null
 * @returns A long-form date, the raw value if unparseable, or empty string
 */
export function snapshotDateLabel(raw: string | null): string {
  if (!raw) {
    return '';
  }
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) {
    return raw;
  }
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime())
    ? raw
    : d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

/**
 * Empty-state description for the active scope.
 * @param tournament - The selected tournament key
 * @returns Copy naming the scope that was searched
 */
export function emptyDescription(tournament: string): string {
  if (tournament === ONLINE_META_NAME) {
    return "That set/number combination doesn't appear in the current online meta report. The card may not have been played in the rolling 14-day window.";
  }
  return `That set/number combination doesn't appear in the ${nameFromTournamentKey(tournament)} report.`;
}

// ---------------------------------------------------------------------------
// Price joins
// ---------------------------------------------------------------------------

/**
 * The price to show for the card, or for the previewed printing.
 *
 * `prices.json` keys the CURRENT global canonical UID (the producer resolves
 * through synonyms), but the rendered card may be a rolling-canonical print —
 * hence the fallback to the global UID.
 * @param card - The rendered card
 * @param prices - The price map, or null while loading
 * @param preview - A previewed printing, when the strip has a selection
 * @param globalUid - The card's global canonical UID
 * @returns The price entry, or null
 */
export function resolvePriceEntry(
  card: CardItem | undefined,
  prices: Record<string, PricingEntry> | null,
  preview: SelectedPrint | null,
  globalUid: string | null
): PricingEntry | null {
  if (!card || !prices) {
    return null;
  }
  if (preview) {
    // A previewed printing shows its own price: prices.json when the print is
    // the tracked canonical (which also carries the TCGplayer id), otherwise
    // the synonym DB's scraped per-print price.
    const entry = prices[preview.uid];
    const price = entry?.price ?? preview.price ?? undefined;
    return price === undefined || price === null ? null : { price, tcgPlayerId: entry?.tcgPlayerId };
  }
  return prices[cardUidOrName(card.name, card.set, card.number)] ?? prices[globalUid ?? ''] ?? null;
}

/**
 * The sparkline series for the card, or for the previewed printing.
 *
 * A previewed printing gets only its own history — another print's trend would
 * lie. The pipeline currently tracks the canonical print, so most previews drop
 * the sparkline; per-print histories light up automatically if the producer
 * starts writing them.
 * @param card - The rendered card
 * @param history - Per-set price history, or null
 * @param ready - Whether the history spans enough days to plot
 * @param preview - A previewed printing, when the strip has a selection
 * @param globalUid - The card's global canonical UID
 * @returns The points to plot, possibly empty
 */
export function resolvePriceSeries(
  card: CardItem | undefined,
  history: Record<string, PricePoint[]> | null | undefined,
  ready: boolean,
  preview: SelectedPrint | null,
  globalUid: string | null
): PricePoint[] {
  if (!card || !history || !ready) {
    return [];
  }
  if (preview) {
    return history[preview.uid] ?? [];
  }
  return history[cardUidOrName(card.name, card.set, card.number)] ?? history[globalUid ?? ''] ?? [];
}

// ---------------------------------------------------------------------------
// Report joins
// ---------------------------------------------------------------------------

/**
 * Find a card within an archetype report.
 *
 * Matches on set + number with leading zeros normalized, then falls back to a
 * name-only match for reports whose items lack set/number.
 * @param report - The archetype's report
 * @param card - The card to find
 * @returns The matching item, or null
 */
export function findCardInArchetypeReport(report: ArchetypeReport, card: CardItem): CardItem | null {
  if (!report?.items) {
    return null;
  }
  const setU = card.set?.toUpperCase();
  const numKey = card.number != null ? normalizeCardNumberKey(String(card.number)) : null;
  for (const item of report.items) {
    if (setU && numKey && item.set && item.number !== undefined) {
      if (item.set.toUpperCase() === setU && normalizeCardNumberKey(String(item.number)) === numKey) {
        return item;
      }
    }
  }
  for (const item of report.items) {
    if (item.name && card.name && item.name === card.name) {
      return item;
    }
  }
  return null;
}

/**
 * Turn the precomputed `cardUsage.json` index into the row shape the
 * per-archetype fan-out produces.
 *
 * Joins each usage entry's slug to the archetype index for label and icons;
 * `deckTotal` comes from the index's `deckCount` (equal to the archetype
 * report's `deckTotal`). Rows the index cannot join to an archetype are dropped.
 * @param payload - The card-usage index
 * @param list - The archetype index
 * @param card - The rendered card
 * @param db - Synonym database, for the cluster-aware lookup
 * @returns Usage rows
 */
export function buildUsageRowsFromIndex(
  payload: CardUsagePayload,
  list: readonly ArchetypeIndexEntry[],
  card: CardItem,
  db: SynonymDatabase | null
): ArchetypeUsageRow[] {
  const entries = cardUsageForCard(payload, card, db);
  if (!entries) {
    return [];
  }
  const bySlug = new Map(list.map(e => [e.name, e]));
  const rows: ArchetypeUsageRow[] = [];
  for (const usage of entries) {
    const entry = bySlug.get(usage.slug);
    if (!entry) {
      continue;
    }
    const deckTotal = entry.deckCount ?? 0;
    rows.push({
      entry,
      item: {
        name: card.name,
        set: card.set,
        number: card.number,
        uid: itemUid(card),
        found: usage.found,
        total: deckTotal,
        pct: usage.pct,
        dist: usage.dist
      },
      report: { deckTotal }
    });
  }
  return rows;
}

/**
 * Find the card's day-2 conversion row.
 *
 * Cluster-aware first, so a rolling-keyed conversion entry matches a rolling
 * (or global) card and vice versa; then a set/number fallback with leading
 * zeros normalized.
 * @param stats - The event's conversion stats
 * @param card - The rendered card
 * @param db - Synonym database
 * @returns The matching row, or undefined
 */
export function findConversionStat(
  stats: Day2CardStat[] | null | undefined,
  card: CardItem | undefined,
  db: SynonymDatabase | null
): Day2CardStat | undefined {
  if (!card || !stats) {
    return undefined;
  }
  const byCluster = findByClusterUid(stats, itemUid(card), db);
  if (byCluster) {
    return byCluster;
  }
  if (card.set && card.number != null) {
    const setU = card.set.toUpperCase();
    const numKey = normalizeCardNumberKey(String(card.number));
    return stats.find(s => s.set?.toUpperCase() === setU && normalizeCardNumberKey(String(s.number)) === numKey);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Presentation math
// ---------------------------------------------------------------------------

/**
 * Average copies played, weighted by the number of players at each count.
 * @param card - The rendered card
 * @returns The average, or null when the card has no distribution
 */
export function averageCopies(card: Pick<CardItem, 'dist'>): number | null {
  const dist = card.dist ?? [];
  const players = dist.reduce((acc, d) => acc + (d.players ?? 0), 0);
  if (!players) {
    return null;
  }
  const copies = dist.reduce((acc, d) => acc + (d.copies ?? 0) * (d.players ?? 0), 0);
  return copies / players;
}

/**
 * Reasons the conversion rate should not be read too closely.
 *
 * A card played by nearly the whole field just tracks the field's overall day-2
 * rate, and a card seen in a handful of decks is too small a sample.
 * @param card - The rendered card
 * @param conversion - The conversion row, when present
 * @returns Caveat sentences, possibly empty
 */
export function conversionCaveats(
  card: Pick<CardItem, 'pct'>,
  conversion: Pick<Day2CardStat, 'day1Count'> | undefined
): string[] {
  if (!conversion) {
    return [];
  }
  const out: string[] = [];
  if (card.pct >= 60) {
    out.push(
      `${card.pct.toFixed(0)}% of decks play this card. At that usage, conversion mirrors the field's Day 2 rate instead of telling you anything about the card.`
    );
  }
  if (conversion.day1Count <= 15) {
    out.push(
      `Only ${conversion.day1Count.toLocaleString()} deck${conversion.day1Count === 1 ? '' : 's'} in this event played this card. That's too small a sample for a reliable conversion rate.`
    );
  }
  return out;
}

/** Whole-number percent for the usage rows; sub-1% shows as "<1%" instead of rounding to 0. */
export function formatWholePct(p: number): string {
  return p > 0 && p < 1 ? '<1%' : `${Math.round(p)}%`;
}
