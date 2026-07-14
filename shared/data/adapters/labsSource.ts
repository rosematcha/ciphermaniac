/**
 * Labs source → normalized event adapter.
 *
 * The Python Labs scraper's only job is to fetch and reshape what it scraped
 * into the loose {@link LabsSourceEvent} shape below (standings rows, raw
 * decklists, raw match rows, event meta). This adapter applies ALL domain
 * policy — stable IDs, card canonicalization, archetype identity, success tags,
 * match-outcome derivation — to produce a validated {@link NormalizedEvent}.
 * Keeping the policy here (not mirrored in Python) is the whole point of the
 * consolidation: one implementation owns each rule.
 *
 * The output is deliberately built in the contract's canonical storage order
 * (decks by deckId, matches by matchId) so it passes {@link validateNormalizedEvent}.
 * @module shared/data/adapters/labsSource
 */

import {
  cardUid,
  computeSuccessTags,
  deckId as makeDeckId,
  eventId as makeEventId,
  labsParticipantId,
  makeArchetypeIdentity,
  matchId as makeMatchId,
  type CardCategory,
  type DeckCard,
  type EnergyType,
  type Match,
  type NormalizedEvent,
  parseCardUid,
  type Participant,
  type TrainerType
} from '../contracts';
import { canonicalizeVariant, getCanonicalCardFromData, type SynonymDatabase } from '../cardIdentity';
import { sha256Hex } from '../hash';

/** One raw decklist card row as scraped from Labs. */
export interface LabsSourceCard {
  name: string;
  set?: string | null;
  number?: string | number | null;
  count: number;
  category?: string | null;
  trainerType?: string | null;
  energyType?: string | null;
  aceSpec?: boolean;
  regulationMark?: string | null;
}

/** One standings row. */
export interface LabsSourceStanding {
  tpId: string | number;
  playerId?: string | null;
  name: string;
  country?: string | null;
  placement?: number | null;
  wins?: number;
  losses?: number;
  ties?: number;
  points?: number | null;
  opw?: number | null;
  oopw?: number | null;
  madePhase2?: boolean;
  madeTopCut?: boolean;
  dropped?: boolean;
  dqed?: boolean;
  late?: boolean;
  decklistPublished?: boolean;
  dropRound?: number | null;
  icons?: string[];
  labsDeckId?: string | null;
  deckName?: string | null;
}

/** One raw match row (Labs winner codes: a tp id, 0 = tie, -1 = double loss). */
export interface LabsSourceMatch {
  round: number;
  phase?: number | null;
  table?: number | null;
  completed?: boolean;
  p1Id: string | number;
  p2Id?: string | number | null;
  winner?: string | number | null;
}

/** The loose source shape the Python scraper emits. */
export interface LabsSourceEvent {
  labsCode: string;
  meta: {
    name: string;
    date: string;
    players?: number | null;
    division?: string | null;
    hasDay2?: boolean;
    country?: string | null;
    city?: string | null;
    eventType?: string | null;
    updatedAt?: string | null;
    completed?: boolean;
    started?: boolean;
    playersRound1?: number | null;
    decklistCount?: number | null;
    rk9Id?: string | null;
    playlatamId?: string | null;
    sourceTournamentId?: string | null;
  };
  standings: LabsSourceStanding[];
  /** tpId (as string) → raw decklist rows. */
  decklists: Record<string, LabsSourceCard[]>;
  matches?: LabsSourceMatch[];
  /** ISO capture time; source metadata, excluded from semantic hashing. */
  fetchedAt?: string | null;
}

const TRAINER_TYPES: ReadonlySet<string> = new Set(['supporter', 'item', 'stadium', 'tool']);
const ENERGY_TYPES: ReadonlySet<string> = new Set(['basic', 'special']);
const CARD_CATEGORIES: ReadonlySet<string> = new Set(['pokemon', 'trainer', 'energy']);

function toFraction100(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  // Labs emits opp win % as a 0-1 fraction; the contract stores 0-100.
  return Math.round(value * 100 * 1000) / 1000;
}

function normalizeCategory(raw: string | null | undefined): CardCategory {
  const value = (raw ?? '').toLowerCase();
  return CARD_CATEGORIES.has(value) ? (value as CardCategory) : 'pokemon';
}

/** Group a deck's raw rows into canonical {@link DeckCard}s (counted once each). */
function buildDeckCards(rows: LabsSourceCard[], synonymDb: SynonymDatabase | null): DeckCard[] {
  interface Bucket {
    canonicalUid: string;
    count: number;
    category: CardCategory;
    trainerType?: TrainerType | null;
    energyType?: EnergyType | null;
    aceSpec?: boolean;
    regulationMark?: string | null;
    printings: Map<string, { uid: string; name: string; set: string; number: string }>;
  }
  const buckets = new Map<string, Bucket>();

  for (const row of rows) {
    const count = Number(row.count) || 0;
    if (count <= 0) continue;
    const [normSet, normNumber] = canonicalizeVariant(row.set ?? null, row.number ?? null);
    const variantUid = cardUid(row.name, normSet, normNumber);
    const canonicalUid = getCanonicalCardFromData(synonymDb, variantUid);

    let bucket = buckets.get(canonicalUid);
    if (!bucket) {
      bucket = {
        canonicalUid,
        count: 0,
        category: normalizeCategory(row.category),
        trainerType: row.trainerType && TRAINER_TYPES.has(row.trainerType) ? (row.trainerType as TrainerType) : null,
        energyType: row.energyType && ENERGY_TYPES.has(row.energyType) ? (row.energyType as EnergyType) : null,
        aceSpec: row.aceSpec === true,
        regulationMark: row.regulationMark ?? null,
        printings: new Map()
      };
      buckets.set(canonicalUid, bucket);
    }
    bucket.count += count;
    // A printing needs a concrete set+number; name-only rows contribute none.
    if (normSet && normNumber) {
      bucket.printings.set(variantUid, { uid: variantUid, name: row.name, set: normSet, number: normNumber });
    }
  }

  const cards: DeckCard[] = [];
  for (const bucket of buckets.values()) {
    const parsed = parseCardUid(bucket.canonicalUid);
    const canonical = parsed ?? { name: bucket.canonicalUid, set: null, number: null, uid: bucket.canonicalUid };
    const card: DeckCard = {
      canonical: { uid: bucket.canonicalUid, name: canonical.name, set: canonical.set, number: canonical.number },
      printings: [...bucket.printings.values()].sort((a, b) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0)),
      count: bucket.count,
      category: bucket.category
    };
    if (bucket.trainerType) card.trainerType = bucket.trainerType;
    if (bucket.energyType) card.energyType = bucket.energyType;
    if (bucket.aceSpec) card.aceSpec = true;
    if (bucket.regulationMark) card.regulationMark = bucket.regulationMark;
    cards.push(card);
  }
  // Canonical storage order: by canonical uid.
  cards.sort((a, b) => (a.canonical.uid < b.canonical.uid ? -1 : a.canonical.uid > b.canonical.uid ? 1 : 0));
  return cards;
}

/** Derive the perspective-free outcome + winner from a raw Labs winner code. */
function deriveOutcome(
  p1: string,
  p2: string | null,
  winner: string | number | null | undefined,
  rawP1: string | number,
  rawP2: string | number | null | undefined
): { outcome: Match['outcome']; winnerParticipantId: string | null } {
  if (p2 === null) {
    if (winner !== null && winner !== undefined && `${winner}` === `${rawP1}`) return { outcome: 'bye', winnerParticipantId: null };
    if (winner === -1) return { outcome: 'unpaired', winnerParticipantId: null };
    return { outcome: 'unknown', winnerParticipantId: null };
  }
  if (winner === 0) return { outcome: 'tie', winnerParticipantId: null };
  if (winner === -1) return { outcome: 'double_loss', winnerParticipantId: null };
  if (winner !== null && winner !== undefined && `${winner}` === `${rawP1}`) return { outcome: 'decided', winnerParticipantId: p1 };
  if (winner !== null && winner !== undefined && rawP2 !== null && rawP2 !== undefined && `${winner}` === `${rawP2}`) {
    return { outcome: 'decided', winnerParticipantId: p2 };
  }
  return { outcome: 'unknown', winnerParticipantId: null };
}

/**
 * Convert a Labs source event into a normalized event. All identity,
 * canonicalization, tag and outcome policy is applied here.
 * @param source - The scraper's loose source record
 * @param options - Domain databases
 * @param options.synonymDb - Synonym database for canonicalization (or null)
 * @returns A normalized event in canonical storage order
 */
export function labsSourceToNormalized(source: LabsSourceEvent, options: { synonymDb?: SynonymDatabase | null } = {}): NormalizedEvent {
  const synonymDb = options.synonymDb ?? null;
  const scopedEventId = makeEventId('labs-event', source.labsCode);
  const players = Number(source.meta.players ?? source.standings.length) || source.standings.length;

  const idByTp = new Map<string, string>();
  for (const standing of source.standings) {
    idByTp.set(`${standing.tpId}`, labsParticipantId(scopedEventId, standing.tpId));
  }

  const deckIdByParticipant = new Map<string, string>();
  const decks = source.standings
    .filter(standing => Array.isArray(source.decklists[`${standing.tpId}`]) && source.decklists[`${standing.tpId}`].length > 0)
    .map(standing => {
      const participantId = idByTp.get(`${standing.tpId}`)!;
      const cards = buildDeckCards(source.decklists[`${standing.tpId}`], synonymDb);
      const archetype = makeArchetypeIdentity(standing.deckName ?? 'Unknown');
      const successTags = computeSuccessTags(standing.placement ?? null, players, {
        madePhase2: standing.madePhase2 === true,
        madeTopCut: standing.madeTopCut === true,
        appendPhaseTags: true
      });
      const deckId = makeDeckId(participantId, cards, sha256Hex);
      deckIdByParticipant.set(participantId, deckId);
      return {
        schemaVersion: 1 as const,
        deckId,
        participantId,
        playerRef: standing.playerId ?? null,
        archetype,
        cards,
        hasDecklist: true,
        successTags
      };
    });
  decks.sort((a, b) => (a.deckId < b.deckId ? -1 : a.deckId > b.deckId ? 1 : 0));

  const participants: Participant[] = source.standings.map(standing => {
    const participantId = idByTp.get(`${standing.tpId}`)!;
    const dropped = standing.dropped === true;
    return {
      participantId,
      playerRef: standing.playerId ?? null,
      name: standing.name,
      country: standing.country ?? null,
      placement: standing.placement ?? null,
      record: { wins: standing.wins ?? 0, losses: standing.losses ?? 0, ties: standing.ties ?? 0 },
      opwPct: toFraction100(standing.opw),
      oopwPct: toFraction100(standing.oopw),
      points: standing.points ?? null,
      icons: Array.isArray(standing.icons) ? standing.icons : [],
      dropRound: dropped ? standing.dropRound ?? null : null,
      labsDeckId: standing.labsDeckId ?? null,
      deckName: standing.deckName ?? null,
      flags: {
        madePhase2: standing.madePhase2 === true,
        madeTopCut: standing.madeTopCut === true,
        dropped,
        dqed: standing.dqed === true,
        late: standing.late === true,
        decklistPublished: standing.decklistPublished === true
      },
      deckId: deckIdByParticipant.get(participantId) ?? null
    };
  });

  const matches: Match[] = (source.matches ?? []).map(row => {
    const p1 = idByTp.get(`${row.p1Id}`);
    const p2 = row.p2Id !== null && row.p2Id !== undefined ? idByTp.get(`${row.p2Id}`) ?? null : null;
    if (!p1) throw new Error(`labsSourceToNormalized: match references unknown participant ${row.p1Id}`);
    const participantIds = p2 ? [p1, p2] : [p1];
    const { outcome, winnerParticipantId } = deriveOutcome(p1, p2, row.winner, row.p1Id, row.p2Id ?? null);
    const phase = row.phase ?? 1;
    return {
      schemaVersion: 1 as const,
      matchId: makeMatchId(row.round, phase, participantIds),
      round: row.round,
      phase,
      table: row.table ?? null,
      participantIds,
      outcome,
      winnerParticipantId,
      completed: row.completed === true
    };
  });
  matches.sort((a, b) => (a.matchId < b.matchId ? -1 : a.matchId > b.matchId ? 1 : 0));

  const event: NormalizedEvent = {
    schemaVersion: 1,
    eventId: scopedEventId,
    kind: 'labs-event',
    meta: {
      name: source.meta.name,
      date: source.meta.date,
      playerCount: players,
      format: null,
      division: source.meta.division ?? null,
      hasDay2: source.meta.hasDay2 === true,
      country: source.meta.country ?? null,
      city: source.meta.city ?? null,
      eventType: source.meta.eventType ?? null,
      updatedAt: source.meta.updatedAt ?? null,
      completed: source.meta.completed === true,
      started: source.meta.started === true,
      playersRound1: source.meta.playersRound1 ?? null,
      decklistCount: source.meta.decklistCount ?? null,
      rk9Id: source.meta.rk9Id ?? null,
      playlatamId: source.meta.playlatamId ?? null,
      labsCode: source.labsCode,
      sourceTournamentId: source.meta.sourceTournamentId ?? null
    },
    participants,
    decks,
    matches,
    sourceRevisions: [
      {
        source: 'limitless-labs',
        entityId: source.labsCode,
        sourceHash: sha256Hex({ standings: source.standings, decklists: source.decklists, matches: source.matches ?? [] }),
        fetchedAt: source.fetchedAt ?? ''
      }
    ]
  };
  return event;
}
