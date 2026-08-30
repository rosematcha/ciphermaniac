import { normalizeArchetypeName, sanitizeForFilename } from '../cardUtils.js';
import { canonicalPlayerId, overriddenPlayerName } from './playerIdentity';
import { encodeSlimIndex } from '../playerTypes';
import { runWithConcurrency } from './tournamentFetcher';
import { batchDelete, batchPutJson, getJson, getJsonResult, putJson } from './storageWriter';
import type {
  PlayerAggregateManifest,
  PlayerArchetypeBreakdown,
  PlayerDeckCard,
  PlayerDecks,
  PlayerIndexEntry,
  PlayerProfile,
  PlayerTournamentEntry
} from './types';

/**
 * Career-wide player aggregator. Walks every tournament in
 * `reports/tournaments.json`, joins participants + decks by Limitless
 * `playerId`, and emits:
 *   - `players/index.json` (catalog for the index page)
 *   - `players/{playerId}/profile.json` (per-player career profile, no decks)
 *   - `players/{playerId}/decks.json` (decklists, lazy-fetched on expand)
 *   - `players/_manifest.json` (bookkeeping for incremental rebuilds)
 *
 * Participants without a `playerId` are dropped — they can't be reliably
 * joined across events.
 *
 * The build is incremental: only players whose tournament membership has
 * changed since the last run get rewritten.
 */

interface ParticipantRow {
  tpId?: number | string;
  playerId?: number | string | null;
  name?: string;
  country?: string | null;
  placement?: number | null;
  wins?: number | null;
  losses?: number | null;
  ties?: number | null;
  madePhase2?: boolean;
  madeTopCut?: boolean;
  deckId?: string | null;
  deckName?: string | null;
}

interface DeckRow {
  id?: string;
  deckId?: string;
  playerId?: number | string | null;
  player?: string;
  archetype?: string;
  cards?: Array<{
    count?: number;
    name?: string;
    set?: string | null;
    number?: string | number | null;
    category?: string | null;
  }>;
}

interface MetaRow {
  /**
   * Per-tournament reports write `fetchedAt` (set fresh on every download /
   * refresh); the aggregated online-meta report uses `generatedAt`. Either is a
   * usable content fingerprint — a corrected re-download bumps it (P-04).
   */
  fetchedAt?: string;
  generatedAt?: string;
  windowStart?: string;
  windowEnd?: string;
  tournaments?: Array<{ id?: string; name?: string; date?: string; players?: number }>;
  deckTotal?: number;
}

interface TournamentSlice {
  key: string;
  date: string;
  participants: ParticipantRow[];
  decks: DeckRow[];
  totalPlayers: number | null;
  /** Content fingerprint from meta.json (fetchedAt/generatedAt); '' if absent. */
  fingerprint: string;
}

/**
 * Manifest with an added per-tournament content fingerprint map. The field is
 * optional so manifests written before this change (no `fingerprints`) are read
 * gracefully and force a rebuild (P-04). Kept local — the manifest is internal
 * to the cron and not consumed by the frontend.
 */
interface PlayerAggregateManifestV2 extends PlayerAggregateManifest {
  /** tournament key → content fingerprint at last successful build. */
  fingerprints?: Record<string, string>;
}

function sliceFingerprint(meta: MetaRow | null): string {
  return meta?.fetchedAt ?? meta?.generatedAt ?? '';
}

const DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})/;
const MANIFEST_KEY = 'players/_manifest.json';
const INDEX_KEY = 'players/index.json';
// Slim projection the SPA actually downloads (players index table + compare-page
// autocomplete). Full index.json is kept for compatibility / other consumers.
const SLIM_INDEX_KEY = 'players/index-slim.json';

/**
 * Emit the slim index alongside the full one. Written compact on the standard
 * 6-hour live-data cache. Called on every run (including the no-change fast
 * path) so the file exists as soon as this code ships, not only after the next
 * real rebuild.
 */
async function writeSlimIndex(env: unknown, index: PlayerIndexEntry[]): Promise<void> {
  await putJson(env, SLIM_INDEX_KEY, encodeSlimIndex(index), {
    cacheControl: 'public, max-age=21600'
  });
}
// Players with only one event dominate the long tail and inflate the index ~2x
// without adding signal — they're still reachable via direct /players/:id URLs.
const INDEX_MIN_EVENTS = 2;

function archetypeBase(displayName?: string): { base: string; displayName: string } | null {
  if (!displayName) {
    return null;
  }
  const normalized = normalizeArchetypeName(displayName);
  const base = sanitizeForFilename(normalized.replace(/ /g, '_')) || null;
  if (!base) {
    return null;
  }
  return { base, displayName };
}

function normalizePlayerId(raw: unknown): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  const s = String(raw).trim();
  if (!s || s === 'null' || s === 'undefined') {
    return null;
  }
  return s;
}

function extractDate(key: string, meta: MetaRow | null): string | null {
  const m = key.match(DATE_PREFIX);
  if (m) {
    return m[1];
  }
  if (meta?.windowStart) {
    return meta.windowStart.slice(0, 10);
  }
  if (meta?.generatedAt) {
    return meta.generatedAt.slice(0, 10);
  }
  return null;
}

function median(values: number[]): number | null {
  const filtered = values.filter(v => Number.isFinite(v));
  if (!filtered.length) {
    return null;
  }
  const sorted = [...filtered].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

async function loadTournamentSlice(env: unknown, key: string): Promise<TournamentSlice | null> {
  const base = `reports/${key}`;
  const [participantsR, decksR, metaR] = await Promise.all([
    getJsonResult<ParticipantRow[]>(env, `${base}/players.json`),
    getJsonResult<DeckRow[]>(env, `${base}/decks.json`),
    getJsonResult<MetaRow>(env, `${base}/meta.json`)
  ]);
  // A corrupt body or transport failure is NOT the same as a genuinely absent
  // slice. Missing → skip (return null); error → abort the whole run so we
  // never publish player aggregates built from a partial view (P-05).
  if (participantsR.status === 'error') {
    throw new Error(`[playerAggregator] Failed to load ${base}/players.json`, { cause: participantsR.error });
  }
  if (decksR.status === 'error') {
    throw new Error(`[playerAggregator] Failed to load ${base}/decks.json`, { cause: decksR.error });
  }
  if (metaR.status === 'error') {
    throw new Error(`[playerAggregator] Failed to load ${base}/meta.json`, { cause: metaR.error });
  }
  const participants = participantsR.status === 'ok' ? participantsR.value : null;
  const decks = decksR.status === 'ok' ? decksR.value : null;
  const meta = metaR.status === 'ok' ? metaR.value : null;

  if (!Array.isArray(participants) || !participants.length) {
    return null;
  }
  const date = extractDate(key, meta);
  if (!date) {
    console.warn(`[playerAggregator] Skipping ${key}: no date in key or meta`);
    return null;
  }
  const totalPlayers =
    typeof meta?.deckTotal === 'number'
      ? meta.deckTotal
      : Array.isArray(meta?.tournaments) && meta!.tournaments![0]?.players
        ? Number(meta!.tournaments![0].players)
        : participants.length;
  return {
    key,
    date,
    participants,
    decks: Array.isArray(decks) ? decks : [],
    totalPlayers: Number.isFinite(totalPlayers) ? Number(totalPlayers) : null,
    fingerprint: sliceFingerprint(meta)
  };
}

/**
 * Cheap read of just meta.json to fingerprint a tournament's content for the
 * no-change fast path. Corrupt/transport error → throw (aborts the run rather
 * than risk skipping a real change).
 */
async function loadFingerprint(env: unknown, key: string): Promise<string> {
  const metaR = await getJsonResult<MetaRow>(env, `reports/${key}/meta.json`);
  if (metaR.status === 'error') {
    throw new Error(`[playerAggregator] Failed to load reports/${key}/meta.json for fingerprint`, {
      cause: metaR.error
    });
  }
  return sliceFingerprint(metaR.status === 'ok' ? metaR.value : null);
}

interface Accumulator {
  playerId: string;
  names: Map<string, number>;
  countries: Map<string, number>;
  latestName: { name: string; date: string } | null;
  latestCountry: { country: string; date: string } | null;
  entries: PlayerTournamentEntry[];
  /** archetype base → display name observed for this player */
  archetypeNames: Map<string, string>;
  /** tournamentId → deck cards, when a join succeeded */
  decks: Map<string, PlayerDeckCard[]>;
}

function ensureAcc(map: Map<string, Accumulator>, playerId: string): Accumulator {
  let acc = map.get(playerId);
  if (!acc) {
    acc = {
      playerId,
      names: new Map(),
      countries: new Map(),
      latestName: null,
      latestCountry: null,
      entries: [],
      archetypeNames: new Map(),
      decks: new Map()
    };
    map.set(playerId, acc);
  }
  return acc;
}

function buildArchetypes(entries: PlayerTournamentEntry[]): PlayerArchetypeBreakdown[] {
  const groups = new Map<string, PlayerArchetypeBreakdown>();
  for (const entry of entries) {
    if (!entry.archetype) {
      continue;
    }
    let group = groups.get(entry.archetype);
    if (!group) {
      group = {
        base: entry.archetype,
        eventCount: 0,
        wins: 0,
        losses: 0,
        ties: 0,
        day2s: 0,
        topCuts: 0,
        bestPlacement: null
      };
      groups.set(entry.archetype, group);
    }
    group.eventCount += 1;
    group.wins += entry.wins;
    group.losses += entry.losses;
    group.ties += entry.ties;
    if (entry.madePhase2) {
      group.day2s += 1;
    }
    if (entry.madeTopCut) {
      group.topCuts += 1;
    }
    if (entry.placement != null) {
      group.bestPlacement =
        group.bestPlacement == null ? entry.placement : Math.min(group.bestPlacement, entry.placement);
    }
  }
  return Array.from(groups.values()).sort((a, b) => b.eventCount - a.eventCount);
}

function pickPrimaryName(acc: Accumulator): string {
  if (acc.latestName) {
    return acc.latestName.name;
  }
  // Fall back to the most-common observed name rather than arbitrary insertion order.
  let best: { name: string; count: number } | null = null;
  for (const [name, count] of acc.names) {
    if (!best || count > best.count) {
      best = { name, count };
    }
  }
  return best?.name ?? `Player ${acc.playerId}`;
}

/**
 * Diacritic-insensitive name key for the deck-ownership guard. Upstream deck
 * rows and participant rows don't always agree on accents ("José" vs "Jose"),
 * and an exact comparison silently drops those players' legitimate decklists.
 */
function foldName(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
}

function buildProfile(acc: Accumulator, generatedAt: string): PlayerProfile {
  const tournaments = [...acc.entries].sort((a, b) => b.tournamentDate.localeCompare(a.tournamentDate));

  const wins = tournaments.reduce((s, e) => s + e.wins, 0);
  const losses = tournaments.reduce((s, e) => s + e.losses, 0);
  const ties = tournaments.reduce((s, e) => s + e.ties, 0);
  const day2s = tournaments.filter(e => e.madePhase2).length;
  const topCuts = tournaments.filter(e => e.madeTopCut).length;
  const tournamentWins = tournaments.filter(e => e.placement === 1).length;
  const placements = tournaments.map(e => e.placement).filter((p): p is number => typeof p === 'number');
  const bestPlacement = placements.length ? Math.min(...placements) : null;
  const lastEventDate = tournaments[0]?.tournamentDate ?? '';
  const firstEventDate = tournaments[tournaments.length - 1]?.tournamentDate ?? lastEventDate;

  const name = overriddenPlayerName(acc.playerId) ?? pickPrimaryName(acc);
  const countries = Array.from(acc.countries.keys());

  // Only include archetypeNames that actually appear in this profile.
  const archetypeNames: Record<string, string> = {};
  for (const entry of tournaments) {
    if (entry.archetype && acc.archetypeNames.has(entry.archetype)) {
      archetypeNames[entry.archetype] = acc.archetypeNames.get(entry.archetype)!;
    }
  }

  return {
    playerId: acc.playerId,
    name,
    countries,
    generatedAt,
    summary: {
      eventCount: tournaments.length,
      firstEventDate,
      lastEventDate,
      wins,
      losses,
      ties,
      day2s,
      topCuts,
      tournamentWins,
      bestPlacement,
      medianPlacement: median(placements)
    },
    archetypeNames,
    archetypes: buildArchetypes(tournaments),
    tournaments
  };
}

function buildDecks(acc: Accumulator, generatedAt: string): PlayerDecks | null {
  if (!acc.decks.size) {
    return null;
  }
  const decks: Record<string, PlayerDeckCard[]> = {};
  for (const [tournamentId, cards] of acc.decks) {
    decks[tournamentId] = cards;
  }
  return { playerId: acc.playerId, generatedAt, decks };
}

export interface BuildPlayerAggregatesResult {
  index: PlayerIndexEntry[];
  profileCount: number;
  /** Profiles actually written this run (= changed since last manifest). */
  profilesWritten: number;
  tournamentsScanned: number;
  tournamentsSkipped: number;
  /** True when the tournament set was unchanged and no rebuild ran. */
  skippedNoChanges: boolean;
}

function arrayEquals(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

/** The result shape for a run that had nothing to build. */
function emptyAggregateResult(): BuildPlayerAggregatesResult {
  return {
    index: [],
    profileCount: 0,
    profilesWritten: 0,
    tournamentsScanned: 0,
    tournamentsSkipped: 0,
    skippedNoChanges: false
  };
}

/**
 * Reuse the last run's output when nothing has changed, or null to rebuild.
 *
 * Key-membership equality alone is not enough to skip: refresh-recent-tournaments
 * corrects placements and decklists under the same folder name, which changes a
 * tournament's content fingerprint but not the key set (P-04). Manifests written
 * before fingerprints existed have no `fingerprints` map and so always rebuild.
 */
async function tryFastPath(
  env: unknown,
  tournamentList: string[],
  previousManifest: PlayerAggregateManifestV2 | null,
  sliceConcurrency: number
): Promise<BuildPlayerAggregatesResult | null> {
  const prevSorted = previousManifest?.tournamentKeys ? [...previousManifest.tournamentKeys].sort() : null;
  if (!previousManifest || !prevSorted || !arrayEquals([...tournamentList].sort(), prevSorted)) {
    return null;
  }

  const prevFingerprints = previousManifest.fingerprints;
  if (!prevFingerprints) {
    return null;
  }
  const current = await runWithConcurrency(tournamentList, sliceConcurrency, (key: string) =>
    loadFingerprint(env, key)
  );
  if (!tournamentList.every((key, i) => (prevFingerprints[key] ?? '') === current[i])) {
    console.info('[playerAggregator] Tournament set unchanged but content fingerprints differ; rebuilding');
    return null;
  }

  console.info('[playerAggregator] Tournament set and content unchanged; skipping rebuild', {
    tournaments: tournamentList.length
  });
  const index = (await getJson<PlayerIndexEntry[]>(env, INDEX_KEY)) ?? [];
  await writeSlimIndex(env, index);
  return {
    index,
    profileCount: Object.keys(previousManifest.players).length,
    profilesWritten: 0,
    tournamentsScanned: 0,
    tournamentsSkipped: 0,
    skippedNoChanges: true
  };
}

/**
 * Whether this tournament's decks.json keys its `playerId` field by the
 * tournament-scoped `tpId` rather than the canonical Limitless `playerId`.
 *
 * Upstream is inconsistent about this (Worlds 2025, Orlando 2026 and others
 * store tpId there), and the two namespaces overlap — so a try-both join
 * silently misattributes decks across players. Decide once per tournament by
 * sampling which key matches more participants, then use only that one.
 */
function detectJoinsByTpId(slice: TournamentSlice): boolean {
  const deckPidSet = new Set<string>();
  for (const deck of slice.decks) {
    const pid = normalizePlayerId(deck.playerId);
    if (pid) {
      deckPidSet.add(pid);
    }
  }

  let hitsByPlayerId = 0;
  let hitsByTpId = 0;
  for (const participant of slice.participants) {
    const pid = normalizePlayerId(participant.playerId);
    const tpid = participant.tpId != null ? String(participant.tpId) : null;
    if (pid && deckPidSet.has(pid)) {
      hitsByPlayerId += 1;
    }
    if (tpid && deckPidSet.has(tpid)) {
      hitsByTpId += 1;
    }
  }

  if (slice.decks.length && hitsByPlayerId === 0 && hitsByTpId === 0) {
    console.warn(
      `[playerAggregator] Slice ${slice.key} has ${slice.decks.length} decks but neither playerId nor tpId joins — decks will be dropped`
    );
  }
  return hitsByTpId > hitsByPlayerId;
}

/**
 * The deck joined to this participant, or undefined.
 *
 * Even with the right join convention, a deck row's `player` name should
 * roughly match the participant's. When it does not, the join is wrong and the
 * deck is dropped rather than cross-attributed.
 */
function joinDeck(
  participant: ParticipantRow,
  playerId: string,
  decksByJoinKey: Map<string, DeckRow>,
  joinByTpId: boolean
): DeckRow | undefined {
  const joinKey = joinByTpId ? (participant.tpId != null ? String(participant.tpId) : null) : playerId;
  const deck = joinKey ? decksByJoinKey.get(joinKey) : undefined;
  const belongs = !deck || !deck.player || !participant.name || foldName(deck.player) === foldName(participant.name);
  return belongs ? deck : undefined;
}

/** Normalize a joined deck's card rows for the player's decks.json. */
function toPlayerDeckCards(cards: DeckRow['cards']): PlayerDeckCard[] {
  return (cards ?? [])
    .filter(card => card && card.name)
    .map(card => ({
      count: typeof card.count === 'number' ? card.count : Number(card.count) || 1,
      name: String(card.name),
      set: card.set ? String(card.set) : undefined,
      number: card.number != null ? String(card.number) : undefined,
      category: card.category ? String(card.category) : undefined
    }));
}

/**
 * Count one observation of a name or country and return it, or null when the
 * value is blank. The caller decides whether it is the latest, because the
 * accumulator stores the two under different field names.
 */
function countObservation(
  counts: Map<string, number>,
  value: string | null | undefined,
  date: string
): { value: string; date: string } | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) {
    return null;
  }
  counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
  return { value: trimmed, date };
}

/** True when `seen` is newer than what the accumulator already holds. */
function isNewer(seen: { date: string } | null, latest: { date: string } | null | undefined): boolean {
  return Boolean(seen) && (!latest || seen!.date > latest.date);
}

/** One participant's row in their player profile's tournament history. */
function toTournamentEntry(
  participant: ParticipantRow,
  slice: TournamentSlice,
  archetype: string | null,
  joinedDeck: DeckRow | undefined
): PlayerTournamentEntry {
  return {
    tournamentId: slice.key,
    tournamentDate: slice.date,
    totalPlayers: slice.totalPlayers,
    placement: participant.placement ?? null,
    wins: participant.wins ?? 0,
    losses: participant.losses ?? 0,
    ties: participant.ties ?? 0,
    madePhase2: Boolean(participant.madePhase2),
    madeTopCut: Boolean(participant.madeTopCut),
    archetype,
    deckId: joinedDeck?.deckId ?? joinedDeck?.id ?? participant.deckId ?? null
  };
}

/** Fold one tournament's participants and decks into the per-player accumulators. */
function accumulateSlice(accs: Map<string, Accumulator>, slice: TournamentSlice): void {
  const joinByTpId = detectJoinsByTpId(slice);

  const decksByJoinKey = new Map<string, DeckRow>();
  for (const deck of slice.decks) {
    const key = normalizePlayerId(deck.playerId);
    if (key) {
      decksByJoinKey.set(key, deck);
    }
  }

  for (const participant of slice.participants) {
    const rawPlayerId = normalizePlayerId(participant.playerId);
    if (!rawPlayerId) {
      continue;
    }

    // The career accumulates under the canonical id, but the deck join is
    // slice-local and must use the id this tournament actually recorded.
    const acc = ensureAcc(accs, canonicalPlayerId(rawPlayerId));
    const joinedDeck = joinDeck(participant, rawPlayerId, decksByJoinKey, joinByTpId);

    const archetypeLabel = joinedDeck?.archetype ?? participant.deckName ?? null;
    const archetypeInfo = archetypeBase(archetypeLabel ?? undefined);
    if (archetypeInfo) {
      acc.archetypeNames.set(archetypeInfo.base, archetypeInfo.displayName);
    }

    acc.entries.push(toTournamentEntry(participant, slice, archetypeInfo?.base ?? null, joinedDeck));

    // Stashed for the separate decks.json. Never cross-attribute.
    const cards = toPlayerDeckCards(joinedDeck?.cards);
    if (cards.length) {
      acc.decks.set(slice.key, cards);
    }

    const nameSeen = countObservation(acc.names, participant.name, slice.date);
    if (isNewer(nameSeen, acc.latestName)) {
      acc.latestName = { name: nameSeen!.value, date: nameSeen!.date };
    }
    const countrySeen = countObservation(acc.countries, participant.country, slice.date);
    if (isNewer(countrySeen, acc.latestCountry)) {
      acc.latestCountry = { country: countrySeen!.value, date: countrySeen!.date };
    }
  }
}

/** Everything one pass over the accumulators produces. */
interface WritePlan {
  index: PlayerIndexEntry[];
  profileWrites: Array<{ key: string; data: PlayerProfile }>;
  deckWrites: Array<{ key: string; data: PlayerDecks }>;
  deckDeletes: string[];
  manifestPlayers: Record<string, string[]>;
}

/**
 * Decide, for every accumulated player, whether they belong in the index and
 * whether their objects need rewriting this run.
 *
 * A player is skipped only when their tournament set is unchanged from the last
 * run AND none of their events had their content corrected (P-04) — key
 * equality alone would miss a corrected event under an unchanged folder name.
 */
function planWrites(
  accs: Map<string, Accumulator>,
  generatedAt: string,
  prevPlayers: Record<string, string[]>,
  changedTournaments: Set<string>
): WritePlan {
  const plan: WritePlan = { index: [], profileWrites: [], deckWrites: [], deckDeletes: [], manifestPlayers: {} };

  for (const acc of accs.values()) {
    const profile = buildProfile(acc, generatedAt);
    const tournamentKeys = profile.tournaments.map(entry => entry.tournamentId).sort();
    plan.manifestPlayers[acc.playerId] = tournamentKeys;

    if (profile.summary.eventCount >= INDEX_MIN_EVENTS) {
      plan.index.push({
        playerId: profile.playerId,
        name: profile.name,
        country: acc.latestCountry?.country ?? profile.countries[0],
        eventCount: profile.summary.eventCount,
        day2s: profile.summary.day2s,
        topCuts: profile.summary.topCuts,
        tournamentWins: profile.summary.tournamentWins,
        lastEventDate: profile.summary.lastEventDate
      });
    }

    const prevKeys = prevPlayers[acc.playerId];
    const keysUnchanged = prevKeys && arrayEquals(tournamentKeys, [...prevKeys].sort());
    const contentUnchanged = !profile.tournaments.some(entry => changedTournaments.has(entry.tournamentId));
    if (keysUnchanged && contentUnchanged) {
      continue;
    }

    plan.profileWrites.push({ key: `players/${profile.playerId}/profile.json`, data: profile });
    const decks = buildDecks(acc, generatedAt);
    if (decks) {
      plan.deckWrites.push({ key: `players/${profile.playerId}/decks.json`, data: decks });
    } else {
      // No decks this run. A decks.json written by a prior run is now stale, so
      // delete it rather than let expanded rows surface last run's decklists
      // (P-23). Deleting an absent key is a harmless no-op.
      plan.deckDeletes.push(`players/${profile.playerId}/decks.json`);
    }
  }

  return plan;
}

/**
 * Which loaded tournaments changed content since the last manifest. With no
 * previous fingerprints (old manifest, or a forced rebuild) every tournament
 * counts as changed, so every player is rewritten.
 */
function changedTournamentKeys(
  loadedTournamentKeys: string[],
  prevFingerprints: Record<string, string> | undefined,
  fingerprints: Record<string, string>
): Set<string> {
  const changed = new Set<string>();
  for (const key of loadedTournamentKeys) {
    if (!prevFingerprints || (prevFingerprints[key] ?? '') !== (fingerprints[key] ?? '')) {
      changed.add(key);
    }
  }
  return changed;
}

/**
 * Objects belonging to players who were in the previous manifest but not this
 * run — they have dropped out entirely (e.g. their only event was corrected
 * away) and their objects stay addressable unless deleted (P-25).
 */
function orphanDeleteKeys(prevPlayers: Record<string, string[]>, manifestPlayers: Record<string, string[]>): string[] {
  const deletes: string[] = [];
  for (const prevId of Object.keys(prevPlayers)) {
    if (!(prevId in manifestPlayers)) {
      deletes.push(`players/${prevId}/profile.json`, `players/${prevId}/decks.json`);
    }
  }
  return deletes;
}

/**
 * Build every player's profile, decks and the player index from the published
 * tournament slices, and write them to R2.
 *
 * Incremental by default: an unchanged tournament set with unchanged content
 * fingerprints short-circuits entirely, and within a rebuild only players whose
 * events changed are rewritten.
 * @param env - Storage binding
 * @param options - Concurrency limits, and `forceFullRebuild` to ignore the manifest
 * @returns Counts describing what this run scanned and wrote
 */
export async function buildPlayerAggregates(
  env: unknown,
  options: { concurrency?: number; r2Concurrency?: number; forceFullRebuild?: boolean } = {}
): Promise<BuildPlayerAggregatesResult> {
  const sliceConcurrency = Math.max(1, options.concurrency ?? 4);
  const writeConcurrency = Math.max(1, options.r2Concurrency ?? 6);

  const tournamentList = await getJson<string[]>(env, 'reports/tournaments.json');
  if (!Array.isArray(tournamentList) || !tournamentList.length) {
    console.warn('[playerAggregator] reports/tournaments.json missing or empty');
    return emptyAggregateResult();
  }

  const previousManifest = options.forceFullRebuild
    ? null
    : await getJson<PlayerAggregateManifestV2>(env, MANIFEST_KEY);

  const reused = await tryFastPath(env, tournamentList, previousManifest, sliceConcurrency);
  if (reused) {
    return reused;
  }

  // A transport/corrupt failure in loadTournamentSlice throws and propagates
  // here, aborting the whole run — we never publish player aggregates built
  // from a partial slice set (P-05). A genuinely-missing/empty slice returns
  // null and is counted as skipped (legitimate).
  const slices = await runWithConcurrency(tournamentList, sliceConcurrency, (key: string) =>
    loadTournamentSlice(env, key)
  );

  const accs = new Map<string, Accumulator>();
  const loadedTournamentKeys: string[] = [];
  const fingerprints: Record<string, string> = {};
  let skipped = 0;
  let scanned = 0;

  for (const slice of slices) {
    if (!slice) {
      skipped += 1;
      continue;
    }
    scanned += 1;
    loadedTournamentKeys.push(slice.key);
    fingerprints[slice.key] = slice.fingerprint;
    accumulateSlice(accs, slice);
  }

  const generatedAt = new Date().toISOString();
  const prevPlayers = previousManifest?.players ?? {};
  const changedTournaments = changedTournamentKeys(loadedTournamentKeys, previousManifest?.fingerprints, fingerprints);

  const plan = planWrites(accs, generatedAt, prevPlayers, changedTournaments);
  const orphanDeletes = orphanDeleteKeys(prevPlayers, plan.manifestPlayers);

  plan.index.sort((first, second) => {
    if (second.lastEventDate !== first.lastEventDate) {
      return second.lastEventDate.localeCompare(first.lastEventDate);
    }
    return second.eventCount - first.eventCount;
  });

  // Publication order (Theme A / P-24): write bodies FIRST, then delete stale
  // bodies, then the index that points at them, then the manifest last. A
  // failure mid-run must never leave the index/manifest referencing objects
  // that don't exist yet.
  await batchPutJson(env, [...plan.profileWrites, ...plan.deckWrites], writeConcurrency);
  await batchDelete(env, [...plan.deckDeletes, ...orphanDeletes], writeConcurrency);
  await putJson(env, INDEX_KEY, plan.index);
  await writeSlimIndex(env, plan.index);

  const manifest: PlayerAggregateManifestV2 = {
    generatedAt,
    // Only successfully-loaded slices: a transient R2 fetch failure must not
    // be cached as "covered" — next run's fast-path needs to retry it.
    tournamentKeys: loadedTournamentKeys.slice().sort(),
    players: plan.manifestPlayers,
    fingerprints
  };
  await putJson(env, MANIFEST_KEY, manifest);

  console.info('[playerAggregator] Built player aggregates', {
    profiles: accs.size,
    profilesWritten: plan.profileWrites.length,
    deckFilesWritten: plan.deckWrites.length,
    tournamentsScanned: scanned,
    tournamentsSkipped: skipped
  });

  return {
    index: plan.index,
    profileCount: accs.size,
    profilesWritten: plan.profileWrites.length,
    tournamentsScanned: scanned,
    tournamentsSkipped: skipped,
    skippedNoChanges: false
  };
}
