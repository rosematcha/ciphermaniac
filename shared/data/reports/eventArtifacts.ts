/**
 * Event artifact orchestrator.
 *
 * One pure function that turns a NORMALIZED event into the set of serving
 * artifacts, keyed by their relative R2 path. This is the shared builder the
 * plan's architecture diagram calls for: the Labs adapter emits normalized
 * records, and this orchestrator (called by the event build CLI and by Phase 6
 * regeneration) produces every serving body from them — no source fetching, no
 * duplicated domain policy.
 *
 * Card reports, card usage, conversion, matches, player matches and matchup
 * profiles come from the already-consolidated builders. The deck/participant/
 * index/meta projections are simple, consumer-shaped views of the normalized
 * records and live here.
 * @module shared/data/reports/eventArtifacts
 */

import type { DeckCard, NormalizedEvent, Participant } from '../contracts';
import type { SynonymDatabase } from '../cardIdentity';
import { makeRollingResolver } from '../canonicalPrint';
import { type ArchetypeBuildOptions, buildArchetypeReports } from '../archetypes/build';
import { type CardEntry, type DeckEntry, generateReportFromDecks, type LegacyCardReport } from './cardReport';
import { buildCardUsageIndex } from './cardUsage';
import { buildConversionIndex } from './conversion';
import { buildCanonicalMatches, buildPlayerMatches } from './eventMatches';
import { buildMatchupProfiles } from './matchupProfiles';

/**
 * Canonical archetype-build profile for the new pipeline: group by the
 * lowercased comparison key (D3), no minimum-size filter, deterministic
 * deckCount-then-label ordering, signature cards on. The D2 0-100 `sharePct`
 * representation arrives at the Phase 4/6 cutover, so `percent` stays a fraction.
 */
const ARCHETYPE_BUILD_PROFILE: Omit<ArchetypeBuildOptions, 'masterReport'> = {
  nameCasing: 'lower',
  minDecksFraction: 0,
  percentMode: 'fraction',
  sortMode: 'deckCountThenLabel',
  displayNames: 'raw',
  includeSignatureCards: true
};

/** Legacy `decks.json` deck row (the shape current consumers read). */
export interface DeckArtifactRow {
  id: string;
  deckId: string;
  player: string | null;
  playerId: string;
  country: string | null;
  placement: number | null;
  archetype: string;
  cards: CardEntry[];
  successTags: string[];
  hasDecklist: boolean;
  madePhase2: boolean;
  madeTopCut: boolean;
}

/** Legacy `players.json` participant row. */
export interface PlayerArtifactRow {
  playerId: string;
  playerRef: string | null;
  name: string | null;
  country: string | null;
  placement: number | null;
  wins: number;
  losses: number;
  ties: number;
  points: number | null;
  madePhase2: boolean;
  madeTopCut: boolean;
  dropped: boolean;
  dropRound: number | null;
  decklistPublished: boolean;
}

/** Flatten a normalized deck's cards to the canonical serving shape (D4). */
function projectCards(cards: DeckCard[]): CardEntry[] {
  return cards.map(card => {
    const entry: CardEntry = {
      name: card.canonical.name,
      count: card.count,
      category: card.category
    };
    if (card.canonical.set !== null) {
      entry.set = card.canonical.set;
    }
    if (card.canonical.number !== null) {
      entry.number = card.canonical.number;
    }
    if (card.trainerType) {
      entry.trainerType = card.trainerType;
    }
    if (card.energyType) {
      entry.energyType = card.energyType;
    }
    if (card.aceSpec) {
      entry.aceSpec = true;
    }
    if (card.regulationMark) {
      entry.regulationMark = card.regulationMark;
    }
    return entry;
  });
}

function participantIndex(event: NormalizedEvent): Map<string, Participant> {
  const map = new Map<string, Participant>();
  for (const participant of event.participants) {
    map.set(participant.participantId, participant);
  }
  return map;
}

/** Build the `decks.json` serving rows, sorted by (placement, playerId). */
export function buildDecksArtifact(event: NormalizedEvent): DeckArtifactRow[] {
  const participants = participantIndex(event);
  const rows: DeckArtifactRow[] = event.decks.map(deck => {
    const p = participants.get(deck.participantId);
    return {
      id: deck.deckId,
      deckId: deck.deckId,
      player: p?.name ?? null,
      playerId: deck.participantId,
      country: p?.country ?? null,
      placement: p?.placement ?? null,
      archetype: deck.archetype.displayName,
      cards: projectCards(deck.cards),
      successTags: deck.successTags,
      hasDecklist: deck.hasDecklist,
      madePhase2: p?.flags.madePhase2 === true,
      madeTopCut: p?.flags.madeTopCut === true
    };
  });
  rows.sort(
    (a, b) =>
      (a.placement ?? Number.MAX_SAFE_INTEGER) - (b.placement ?? Number.MAX_SAFE_INTEGER) ||
      (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0)
  );
  return rows;
}

/** Build the `players.json` serving rows, sorted by (placement, name). */
export function buildPlayersArtifact(event: NormalizedEvent): PlayerArtifactRow[] {
  const rows: PlayerArtifactRow[] = event.participants.map(p => ({
    playerId: p.participantId,
    playerRef: p.playerRef ?? null,
    name: p.name ?? null,
    country: p.country ?? null,
    placement: p.placement ?? null,
    wins: p.record.wins,
    losses: p.record.losses,
    ties: p.record.ties,
    points: p.points ?? null,
    madePhase2: p.flags.madePhase2 === true,
    madeTopCut: p.flags.madeTopCut === true,
    dropped: p.flags.dropped === true,
    dropRound: p.dropRound ?? null,
    decklistPublished: p.flags.decklistPublished === true
  }));
  rows.sort(
    (a, b) =>
      (a.placement ?? Number.MAX_SAFE_INTEGER) - (b.placement ?? Number.MAX_SAFE_INTEGER) ||
      ((a.name ?? '') < (b.name ?? '') ? -1 : (a.name ?? '') > (b.name ?? '') ? 1 : 0)
  );
  return rows;
}

/** Adapt normalized decks to the legacy report-builder input shape. */
function toDeckEntries(decks: DeckArtifactRow[]): DeckEntry[] {
  return decks.map(deck => ({ cards: deck.cards }));
}

/**
 * Build the report bundle shared by the full event and each slice: master
 * report, archetype index + per-archetype cards/decks files, and the card-usage
 * index. Returns bodies keyed by path relative to `prefix`.
 */
function buildReportBundle(
  decks: DeckArtifactRow[],
  synonymDb: SynonymDatabase | null,
  prefix: string,
  canonicalization: EventCanonicalization | null
): Map<string, unknown> {
  const out = new Map<string, unknown>();
  const resolveUid = canonicalization?.resolveUid;
  const deckTotal = decks.filter(deck => deck.hasDecklist).length;
  const master: LegacyCardReport = generateReportFromDecks(toDeckEntries(decks), deckTotal, synonymDb, { resolveUid });
  if (canonicalization) {
    master.canonicalizedAt = canonicalization.asOfDate;
  }
  out.set(`${prefix}master.json`, master);
  out.set(`${prefix}decks.json`, decks);

  const archetypeInputs = decks.map(deck => ({ cards: deck.cards, archetype: deck.archetype }));
  const built = buildArchetypeReports(archetypeInputs, synonymDb, {
    ...ARCHETYPE_BUILD_PROFILE,
    masterReport: master,
    resolveUid
  });
  out.set(`${prefix}archetypes/index.json`, built.index);
  for (const file of built.files) {
    if (canonicalization) {
      file.data.canonicalizedAt = canonicalization.asOfDate;
    }
    out.set(`${prefix}archetypes/${file.base}/cards.json`, file.data);
    out.set(`${prefix}archetypes/${file.base}/decks.json`, built.decksByBase.get(file.base) ?? []);
  }
  const usage = buildCardUsageIndex(built.files);
  out.set(
    `${prefix}cardUsage.json`,
    canonicalization ? { ...usage, canonicalizedAt: canonicalization.asOfDate } : usage
  );
  return out;
}

/** A rolling-canonical binding for one event: the date plus its bound resolver. */
interface EventCanonicalization {
  asOfDate: string;
  resolveUid: (uid: string) => string;
}

/**
 * Build every serving artifact for one event, keyed by relative path. The
 * volatile `generatedAt` and R2 keys are added by the publishing layer.
 * @param event - Normalized event
 * @param options - Domain databases
 * @param options.synonymDb - Synonym database for canonicalization (or null)
 * @param options.rollingCanonicals - Canonicalize card UIDs as of the event's
 * date (rolling canonicals) instead of the flat current-canonical map. Requires
 * `synonymDb` and `event.meta.date`; artifacts carry a `canonicalizedAt` marker
 * so read-time re-canonicalization is skipped.
 * @param options.printPrices - Event-date print prices (uid -> USD) from the
 * TCGCSV backfill, overriding the synonym DB's current scrape.
 * @returns Map of relative artifact path to JSON body
 */
export function buildEventArtifacts(
  event: NormalizedEvent,
  options: {
    synonymDb?: SynonymDatabase | null;
    rollingCanonicals?: boolean;
    printPrices?: Record<string, number | null> | null;
  } = {}
): Map<string, unknown> {
  const synonymDb = options.synonymDb ?? null;
  let canonicalization: EventCanonicalization | null = null;
  if (options.rollingCanonicals) {
    if (!synonymDb) {
      throw new Error('buildEventArtifacts: rollingCanonicals requires a synonymDb');
    }
    const asOfDate = event.meta.date;
    if (!asOfDate) {
      throw new Error('buildEventArtifacts: rollingCanonicals requires event.meta.date');
    }
    canonicalization = {
      asOfDate,
      resolveUid: makeRollingResolver(synonymDb, asOfDate, options.printPrices ?? null)
    };
  }
  const decks = buildDecksArtifact(event);
  const players = buildPlayersArtifact(event);

  const artifacts = new Map<string, unknown>();
  // Full-event report bundle (master, archetypes, per-archetype files, usage).
  for (const [path, body] of buildReportBundle(decks, synonymDb, '', canonicalization)) {
    artifacts.set(path, body);
  }

  // Day-2 and top-cut slices reuse the same bundle over a filtered deck set.
  for (const [name, keep] of [
    ['phase2', (deck: DeckArtifactRow) => deck.madePhase2],
    ['topcut', (deck: DeckArtifactRow) => deck.madeTopCut]
  ] as const) {
    const sliceDecks = decks.filter(keep);
    if (sliceDecks.length > 0) {
      for (const [path, body] of buildReportBundle(sliceDecks, synonymDb, `slices/${name}/`, canonicalization)) {
        artifacts.set(path, body);
      }
    }
  }

  artifacts.set('players.json', players);
  artifacts.set('matches.json', buildCanonicalMatches(event));
  artifacts.set('playerMatches.json', buildPlayerMatches(event));

  const conversion = buildConversionIndex(
    event.decks.map(deck => ({
      cards: deck.cards.map(card => ({
        name: card.canonical.name,
        set: card.canonical.set ?? undefined,
        number: card.canonical.number ?? undefined,
        count: card.count
      })),
      madePhase2: participantIndex(event).get(deck.participantId)?.flags.madePhase2 === true
    })),
    synonymDb,
    { resolveUid: canonicalization?.resolveUid }
  );
  if (conversion !== null) {
    if (canonicalization) {
      conversion.canonicalizedAt = canonicalization.asOfDate;
    }
    artifacts.set('conversion.json', conversion);
  }

  // Matchup profiles are meaningful only where matches exist (Labs events).
  if (event.matches.length > 0) {
    artifacts.set('matchupProfiles.json', buildMatchupProfiles(event));
  }

  artifacts.set('index.json', buildEventIndex(event, decks, decks.filter(deck => deck.hasDecklist).length));
  artifacts.set('meta.json', buildEventMeta(event));
  return artifacts;
}

/** Build the `index.json` event summary (counts only, deterministic). */
export function buildEventIndex(event: NormalizedEvent, decks: DeckArtifactRow[], deckTotal: number): unknown {
  const archetypes = new Set(event.decks.map(deck => deck.archetype.key));
  return {
    schemaVersion: event.schemaVersion,
    name: event.meta.name,
    date: event.meta.date,
    kind: event.kind,
    participantCount: event.participants.length,
    deckCount: decks.length,
    decklistCount: deckTotal,
    matchCount: event.matches.length,
    archetypeCount: archetypes.size,
    phase2Count: event.participants.filter(p => p.flags.madePhase2).length,
    topcutCount: event.participants.filter(p => p.flags.madeTopCut).length
  };
}

/** Build the `meta.json` event header (projection of normalized meta). */
export function buildEventMeta(event: NormalizedEvent): unknown {
  return {
    schemaVersion: event.schemaVersion,
    kind: event.kind,
    ...event.meta
  };
}
