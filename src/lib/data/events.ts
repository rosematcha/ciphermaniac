/**
 * Per-tournament event data: participants, decklists, and the day-2 conversion
 * statistics derived from them.
 *
 * Day-2 stats come from the prebuilt conversion index when the event has one
 * and are computed from raw decks otherwise, so older events keep working
 * without the producer having backfilled them.
 * @module src/lib/data/events
 */

import { dataClient } from './client';
import { tournamentPath } from './paths';
import { getCanonicalCardFromData } from '../../../shared/synonyms.js';
import { cardUidOrName } from '../../../shared/data/cardIdentity';
import { getSynonymDatabase } from '../../utils/cardSynonyms';
import type { TournamentParticipant } from '../../types';
import { fetchMaster, type MasterPayload } from './reports';
import { itemUid } from './compat';

const { fetchJsonOptional } = dataClient;

// --- Player data (per-tournament only) ---

export function fetchParticipants(tournament: string): Promise<TournamentParticipant[] | null> {
  return fetchJsonOptional<TournamentParticipant[]>(`${tournamentPath(tournament)}/players.json`);
}

interface DeckCardRecord {
  count: number;
  name: string;
  set?: string;
  number?: string;
  category?: string;
  evolutionInfo?: string;
  fullType?: string;
}
export interface DeckRecord {
  id: string;
  deckId: string;
  player: string;
  playerId: string;
  country?: string;
  placement?: number;
  archetype: string;
  archetypeId: string;
  cards: DeckCardRecord[];
  /** Whether this deck's pilot made the Day 2 cut (Phase 2). */
  madePhase2?: boolean;
}

function fetchDecks(tournament: string): Promise<DeckRecord[] | null> {
  return fetchJsonOptional<DeckRecord[]>(`${tournamentPath(tournament)}/decks.json`);
}

export interface Day2CardStat {
  uid: string;
  name: string;
  set: string;
  number: string;
  /** Decks playing this card on Day 1 */
  day1Count: number;
  /** Of those, how many were piloted by a player who made Day 2 */
  day2Count: number;
  /** day2Count / day1Count * 100 */
  conversion: number;
}

/**
 * Precomputed Day 1 → Day 2 conversion counts for one tournament
 * (`conversion.json`, built by the pipeline). Keyed by canonical card UID so it
 * lines up with master.json. Absent for events ingested before the file existed
 * (callers fall back to computing from decks.json).
 */
export interface ConversionPayload {
  day1Total: number;
  day2Total: number;
  cards: Record<string, { day1: number; day2: number }>;
  /** Set on rebaked events; `cards` keys are then rolling-canonical UIDs. */
  canonicalizedAt?: string;
}

export function fetchConversionIndex(tournament: string): Promise<ConversionPayload | null> {
  return fetchJsonOptional<ConversionPayload>(`${tournamentPath(tournament)}/conversion.json`);
}

/** Map canonical UID → display name/set/number from the (canonicalized) master report. */
function buildDisplayMap(master: MasterPayload): Map<string, { name: string; set: string; number: string }> {
  const display = new Map<string, { name: string; set: string; number: string }>();
  for (const item of master.items) {
    display.set(itemUid(item), {
      name: item.name,
      set: item.set ?? '',
      number: String(item.number ?? '')
    });
  }
  return display;
}

/** Resolve display fields for a UID, falling back to parsing `Name::SET::NUMBER`. */
function displayForUid(
  uid: string,
  display: Map<string, { name: string; set: string; number: string }>
): { name: string; set: string; number: string } | null {
  const hit = display.get(uid);
  if (hit) {
    return hit;
  }
  const parts = uid.split('::');
  if (parts.length < 3) {
    return null;
  }
  return { name: parts[0], set: parts[1], number: parts[2] };
}

/**
 * Compute per-card Day 1 → Day 2 conversion for a single tournament.
 *
 * Fast path: the pipeline precomputes `conversion.json` (per-UID day1/day2
 * counts) so we avoid downloading the multi-MB decks.json. Falls back to the
 * decks-based computation for events generated before that file existed (404).
 * Returns null when the tournament has no Day 2 cut — Online Meta in particular
 * has no single cut, so callers should not invoke this for that key.
 */
export async function fetchDay2CardStats(tournament: string): Promise<Day2CardStat[] | null> {
  const conversion = await fetchConversionIndex(tournament);
  if (conversion) {
    return day2CardStatsFromConversion(conversion, tournament);
  }
  return day2CardStatsFromDecks(tournament);
}

async function day2CardStatsFromConversion(
  conversion: ConversionPayload,
  tournament: string
): Promise<Day2CardStat[] | null> {
  if (conversion.day2Total === 0) {
    return null;
  }
  const entries = Object.entries(conversion.cards);
  if (entries.length === 0) {
    return null;
  }
  const master = await fetchMaster(tournament);
  const display = buildDisplayMap(master);
  const out: Day2CardStat[] = [];
  for (const [uid, c] of entries) {
    const d = displayForUid(uid, display);
    if (!d) {
      continue;
    }
    out.push({
      uid,
      name: d.name,
      set: d.set,
      number: d.number,
      day1Count: c.day1,
      day2Count: c.day2,
      conversion: c.day1 > 0 ? (c.day2 / c.day1) * 100 : 0
    });
  }
  return out;
}

async function day2CardStatsFromDecks(tournament: string): Promise<Day2CardStat[] | null> {
  const [decks, master, db] = await Promise.all([
    fetchDecks(tournament),
    fetchMaster(tournament),
    getSynonymDatabase()
  ]);
  if (!decks || decks.length === 0) {
    return null;
  }
  // If no deck claims madePhase2, the tournament probably never reached a cut
  // (or the flag isn't populated yet) — nothing meaningful to render.
  if (!decks.some(d => d.madePhase2)) {
    return null;
  }

  // master.json items are already canonicalized — use them as the source of
  // truth for display name/set/number so the graphic matches the rest of the
  // site.
  const display = buildDisplayMap(master);

  const counts = new Map<string, { day1: number; day2: number }>();
  for (const deck of decks) {
    const isDay2 = deck.madePhase2 === true;
    const seenInDeck = new Set<string>();
    for (const card of deck.cards) {
      if (!card.set || card.number === undefined || card.number === null || card.number === '') {
        continue;
      }
      // Deck cards carry RAW printings (`TWM/95`) while the synonym database
      // keys UIDs zero-padded (`TWM/095`) — 547 of its 2,295 entries have a
      // leading zero. Interpolating the fields directly missed every one of
      // them, so a card played as two printings counted as two rows here.
      const rawUid = cardUidOrName(card.name ?? '', card.set, card.number);
      const uid = db ? getCanonicalCardFromData(db, rawUid) : rawUid;
      // A deck listing the same canonical card under two variant printings
      // should still only count once toward inclusion.
      if (seenInDeck.has(uid)) {
        continue;
      }
      seenInDeck.add(uid);
      let entry = counts.get(uid);
      if (!entry) {
        entry = { day1: 0, day2: 0 };
        counts.set(uid, entry);
      }
      entry.day1 += 1;
      if (isDay2) {
        entry.day2 += 1;
      }
    }
  }

  const out: Day2CardStat[] = [];
  for (const [uid, c] of counts) {
    // Card present in decks but not in master (rare — typically dropped by
    // canonicalization) falls back to parsing the UID.
    const d = displayForUid(uid, display);
    if (!d) {
      continue;
    }
    out.push({
      uid,
      name: d.name,
      set: d.set,
      number: d.number,
      day1Count: c.day1,
      day2Count: c.day2,
      conversion: c.day1 > 0 ? (c.day2 / c.day1) * 100 : 0
    });
  }
  return out;
}

/**
 * Per-archetype deck list. Used by the Advanced filter builder so the
 * full tournament `decks.json` (much larger) doesn't have to be paid for.
 */
export function fetchArchetypeDecks(tournament: string, archetypeBase: string): Promise<DeckRecord[] | null> {
  return fetchJsonOptional<DeckRecord[]>(
    `${tournamentPath(tournament)}/archetypes/${encodeURIComponent(archetypeBase)}/decks.json`
  );
}
