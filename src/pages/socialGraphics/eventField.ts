/**
 * The live-event side of the Fraudulent comparison.
 *
 * Fraudulent reads a card's reputation off the rolling online window and its
 * results off the events played during that same window, so this module answers
 * two questions: which events fall inside the window, and what their card
 * counts look like pooled into a single field.
 *
 * The pooling re-keys every event row onto TODAY's canonical print. Rebaked
 * events are already canonicalized to their own event-date print (D17), which
 * is the right thing for displaying that event but leaves the two sides of this
 * comparison speaking different UIDs — Worlds keys Dudunsparce as TEF 129 while
 * the online window keys it as PRE 080, and an unmapped join reports a 20%
 * online card as literally unplayed at the event. Only the join key is
 * rewritten; every rendered field still comes from the online row.
 * @module src/pages/socialGraphics/eventField
 */

import { getCanonicalCardFromData, type SynonymDatabase } from '../../../shared/synonyms.js';
import { tournamentDate } from '../../../shared/data/tournamentKeys';
import { fetchMaster, fetchMeta, type MasterPayload } from '../../lib/data';
import { itemUid } from '../../lib/data/compat';
import { getSynonymDatabase } from '../../utils/cardSynonyms';
import { ONLINE_META_NAME } from '../../lib/constants';
import { shortTournament } from './model';

/** The live events of one window, pooled into a single field to measure against. */
export interface EventField {
  /** Decks across every pooled event. */
  deckTotal: number;
  /** Canonical card UID to the number of those decks playing the card. */
  found: Map<string, number>;
  /** The tournament keys pooled, most recent first. */
  events: string[];
  /**
   * Set codes that appeared at those events, the legality guard for the
   * comparison. A set can release inside the online window, or after the event
   * the field fell back to, and every card in it would then read as a total
   * fraud — heavily played online, in none of the event's decks.
   */
  sets: Set<string>;
  /**
   * True when the window held no events at all and the field fell back to the
   * most recent one. The tool says so, because a card measured against an event
   * outside the online window is a looser claim.
   */
  fellBack: boolean;
}

/**
 * Dated events whose date falls inside the window, most recent first.
 *
 * The filter is "has a date", not `majorTournaments` — that classifier reads
 * the event name and does not recognize a World Championship, so it would drop
 * the one event this graphic most wants to measure against. Every key in the
 * tournament list is a live event; only the rolling online report is undated.
 */
export function eventsInWindow(list: string[], start: Date, end: Date): string[] {
  return datedEvents(list)
    .filter(e => e.date.getTime() >= start.getTime() && e.date.getTime() <= end.getTime())
    .map(e => e.key);
}

/** Every key the tournament-key format can date, most recent first. */
function datedEvents(list: string[]): { key: string; date: Date }[] {
  return list
    .map(key => ({ key, date: tournamentDate(key) }))
    .filter((e): e is { key: string; date: Date } => e.date !== null)
    .sort((a, b) => b.date.getTime() - a.date.getTime());
}

/** The most recent event in the list, or null when there are none. */
function latestEvent(list: string[]): string | null {
  const dated = datedEvents(list);
  return dated.length ? dated[0].key : null;
}

/**
 * The events the field pools: those inside the window, or the most recent event
 * when the window is empty.
 *
 * Events cluster on weekends and then stop for months — this year nothing was
 * played between June 12 and August 28 — so a strict window would blank the
 * mode for most of the offseason.
 * @param list - Every tournament key, in any order
 * @param start - Window start (inclusive)
 * @param end - Window end (inclusive)
 * @returns The keys to pool, and whether they came from the fallback
 */
export function selectFieldEvents(list: string[], start: Date, end: Date): { events: string[]; fellBack: boolean } {
  const inWindow = eventsInWindow(list, start, end);
  if (inWindow.length > 0) {
    return { events: inWindow, fellBack: false };
  }
  const latest = latestEvent(list);
  return latest ? { events: [latest], fellBack: true } : { events: [], fellBack: false };
}

/**
 * Sum the events' card counts into one field, keyed by today's canonical UID.
 * @param events - The pooled tournament keys, most recent first
 * @param payloads - Their master reports, in the same order
 * @param db - The synonym database, or null to key by the reports' own UIDs
 * @param fellBack - Whether the events came from the empty-window fallback
 * @returns The pooled field
 */
export function poolEventField(
  events: string[],
  payloads: (MasterPayload | null)[],
  db: SynonymDatabase | null,
  fellBack: boolean
): EventField {
  const found = new Map<string, number>();
  const sets = new Set<string>();
  let deckTotal = 0;
  const pooled: string[] = [];
  payloads.forEach((payload, idx) => {
    if (!payload) {
      return;
    }
    pooled.push(events[idx]);
    deckTotal += payload.deckTotal;
    for (const item of payload.items) {
      const uid = itemUid(item);
      const key = db ? getCanonicalCardFromData(db, uid) : uid;
      found.set(key, (found.get(key) ?? 0) + item.found);
      if (item.set) {
        sets.add(item.set.toUpperCase());
      }
    }
  });
  return { deckTotal, found, events: pooled, sets, fellBack };
}

/**
 * Load the event field for the online window the report itself declares.
 *
 * Reading the window off `meta.json` rather than assuming fourteen days keeps
 * the two sides on the same period even if the online cron's lookback changes.
 * @param list - Every tournament key
 * @returns The pooled field, or null when no event could be loaded
 */
export async function fetchEventField(list: string[]): Promise<EventField | null> {
  const meta = await fetchMeta(ONLINE_META_NAME);
  const start = new Date(meta.windowStart);
  const end = new Date(meta.windowEnd);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }
  const { events, fellBack } = selectFieldEvents(list, start, end);
  if (events.length === 0) {
    return null;
  }
  const [payloads, db] = await Promise.all([
    Promise.all(events.map(key => fetchMaster(key).catch(() => null))),
    getSynonymDatabase()
  ]);
  const field = poolEventField(events, payloads, db, fellBack);
  return field.deckTotal > 0 ? field : null;
}

/** How the graphic names what it measured the online window against. */
export function eventFieldLabel(field: EventField): string {
  if (field.events.length === 1) {
    return shortTournament(field.events[0]);
  }
  return `${field.events.length} events`;
}
