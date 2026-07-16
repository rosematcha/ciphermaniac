import { normalizeArchetypeName, sanitizeForFilename } from '../cardUtils.js';
import { toSlimIndexEntry } from '../playerTypes';
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
  await putJson(env, SLIM_INDEX_KEY, index.map(toSlimIndexEntry), {
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

function normalizeAliasKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function dedupeAliases(names: Iterable<string>, primary: string): string[] {
  const primaryKey = normalizeAliasKey(primary);
  const seen = new Set<string>([primaryKey]);
  const out: string[] = [];
  for (const raw of names) {
    const key = normalizeAliasKey(raw);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(raw);
  }
  return out;
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

  const name = pickPrimaryName(acc);
  const aliases = dedupeAliases(acc.names.keys(), name);
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
    aliases,
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

export async function buildPlayerAggregates(
  env: unknown,
  options: { concurrency?: number; r2Concurrency?: number; forceFullRebuild?: boolean } = {}
): Promise<BuildPlayerAggregatesResult> {
  const sliceConcurrency = Math.max(1, options.concurrency ?? 4);
  const writeConcurrency = Math.max(1, options.r2Concurrency ?? 6);

  const tournamentList = await getJson<string[]>(env, 'reports/tournaments.json');
  if (!Array.isArray(tournamentList) || !tournamentList.length) {
    console.warn('[playerAggregator] reports/tournaments.json missing or empty');
    return {
      index: [],
      profileCount: 0,
      profilesWritten: 0,
      tournamentsScanned: 0,
      tournamentsSkipped: 0,
      skippedNoChanges: false
    };
  }

  const previousManifest = options.forceFullRebuild
    ? null
    : await getJson<PlayerAggregateManifestV2>(env, MANIFEST_KEY);

  // Fast path: skip the rebuild only if BOTH the tournament set AND every
  // tournament's content fingerprint match the last run. Key-membership
  // equality alone is not enough: `refresh-recent-tournaments.py` corrects
  // placements/decklists under the same folder name, which changes meta's
  // `fetchedAt` but not the key set (P-04). Manifests written before
  // fingerprints existed have no `fingerprints` map → treated as changed.
  const currentSorted = [...tournamentList].sort();
  const prevSorted = previousManifest?.tournamentKeys ? [...previousManifest.tournamentKeys].sort() : null;
  if (previousManifest && prevSorted && arrayEquals(currentSorted, prevSorted)) {
    const prevFingerprints = previousManifest.fingerprints;
    let contentUnchanged = false;
    if (prevFingerprints) {
      const current = await runWithConcurrency(tournamentList, sliceConcurrency, (key: string) =>
        loadFingerprint(env, key)
      );
      contentUnchanged = tournamentList.every((key, i) => (prevFingerprints[key] ?? '') === current[i]);
    }
    if (contentUnchanged) {
      console.info('[playerAggregator] Tournament set and content unchanged; skipping rebuild', {
        tournaments: currentSorted.length
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
    console.info('[playerAggregator] Tournament set unchanged but content fingerprints differ; rebuilding');
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

    // Upstream tournaments are inconsistent about what they put in
    // decks.json's `playerId` field: some use the canonical Limitless
    // `playerId`, others (Worlds 2025, Orlando 2026, ...) actually store the
    // tournament-scoped `tpId` there. The two namespaces overlap, so a
    // try-both join silently misattributes decks across players. Detect the
    // convention once per tournament by sampling which key matches more
    // participants, then use only that key.
    const deckPidSet = new Set<string>();
    for (const deck of slice.decks) {
      const pid = normalizePlayerId(deck.playerId);
      if (pid) {
        deckPidSet.add(pid);
      }
    }
    let hitsByPlayerId = 0;
    let hitsByTpId = 0;
    for (const p of slice.participants) {
      const pid = normalizePlayerId(p.playerId);
      const tpid = p.tpId != null ? String(p.tpId) : null;
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
    const joinByTpId = hitsByTpId > hitsByPlayerId;

    const decksByJoinKey = new Map<string, DeckRow>();
    for (const deck of slice.decks) {
      const key = normalizePlayerId(deck.playerId);
      if (key) {
        decksByJoinKey.set(key, deck);
      }
    }

    for (const participant of slice.participants) {
      const playerId = normalizePlayerId(participant.playerId);
      if (!playerId) {
        continue;
      }

      const acc = ensureAcc(accs, playerId);
      const joinKey = joinByTpId ? (participant.tpId != null ? String(participant.tpId) : null) : playerId;
      const deck = joinKey ? decksByJoinKey.get(joinKey) : undefined;

      // Even with the right convention, a deck row's `player` name should at
      // least roughly match the participant's name. If not, the join is wrong.
      const deckBelongs =
        !deck ||
        !deck.player ||
        !participant.name ||
        deck.player.trim().toLowerCase() === participant.name.trim().toLowerCase();
      const joinedDeck = deckBelongs ? deck : undefined;

      const archetypeLabel = joinedDeck?.archetype ?? participant.deckName ?? null;
      const archetypeInfo = archetypeBase(archetypeLabel ?? undefined);
      if (archetypeInfo) {
        acc.archetypeNames.set(archetypeInfo.base, archetypeInfo.displayName);
      }

      const wins = participant.wins ?? 0;
      const losses = participant.losses ?? 0;
      const ties = participant.ties ?? 0;

      const entry: PlayerTournamentEntry = {
        tournamentId: slice.key,
        tournamentDate: slice.date,
        totalPlayers: slice.totalPlayers,
        placement: participant.placement ?? null,
        wins,
        losses,
        ties,
        madePhase2: Boolean(participant.madePhase2),
        madeTopCut: Boolean(participant.madeTopCut),
        archetype: archetypeInfo?.base ?? null,
        deckId: joinedDeck?.deckId ?? joinedDeck?.id ?? participant.deckId ?? null
      };
      acc.entries.push(entry);

      // Stash the deck for the separate decks.json. Never cross-attribute.
      if (joinedDeck?.cards?.length) {
        const cards: PlayerDeckCard[] = joinedDeck.cards
          .filter(c => c && c.name)
          .map(c => ({
            count: typeof c.count === 'number' ? c.count : Number(c.count) || 1,
            name: String(c.name),
            set: c.set ? String(c.set) : undefined,
            number: c.number != null ? String(c.number) : undefined,
            category: c.category ? String(c.category) : undefined
          }));
        if (cards.length) {
          acc.decks.set(slice.key, cards);
        }
      }

      const name = (participant.name ?? '').trim();
      if (name) {
        acc.names.set(name, (acc.names.get(name) ?? 0) + 1);
        if (!acc.latestName || slice.date > acc.latestName.date) {
          acc.latestName = { name, date: slice.date };
        }
      }
      const country = (participant.country ?? '').trim();
      if (country) {
        acc.countries.set(country, (acc.countries.get(country) ?? 0) + 1);
        if (!acc.latestCountry || slice.date > acc.latestCountry.date) {
          acc.latestCountry = { country, date: slice.date };
        }
      }
    }
  }

  const generatedAt = new Date().toISOString();
  const index: PlayerIndexEntry[] = [];
  const profileWrites: Array<{ key: string; data: PlayerProfile }> = [];
  const deckWrites: Array<{ key: string; data: PlayerDecks }> = [];
  const deckDeletes: string[] = [];
  const manifestPlayers: Record<string, string[]> = {};
  const prevPlayers = previousManifest?.players ?? {};

  // Which loaded tournaments changed content since the last manifest. A player
  // whose tournament *key set* is unchanged but one of whose events was
  // corrected (same folder, new fingerprint) must still be rewritten (P-04).
  // No previous fingerprints (old manifest / forced rebuild) → treat every
  // tournament as changed so all players are rewritten.
  const prevFingerprintMap = previousManifest?.fingerprints;
  const changedTournaments = new Set<string>();
  for (const key of loadedTournamentKeys) {
    if (!prevFingerprintMap || (prevFingerprintMap[key] ?? '') !== (fingerprints[key] ?? '')) {
      changedTournaments.add(key);
    }
  }

  for (const acc of accs.values()) {
    const profile = buildProfile(acc, generatedAt);
    const tournamentKeys = profile.tournaments.map(t => t.tournamentId).sort();
    manifestPlayers[acc.playerId] = tournamentKeys;

    if (profile.summary.eventCount >= INDEX_MIN_EVENTS) {
      index.push({
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

    // Incremental skip: skip the write only if this player's tournament set is
    // unchanged from the last run AND none of their events had their content
    // corrected this run (P-04).
    const prevKeys = prevPlayers[acc.playerId];
    const keysUnchanged = prevKeys && arrayEquals(tournamentKeys, [...prevKeys].sort());
    const contentUnchanged = !profile.tournaments.some(t => changedTournaments.has(t.tournamentId));
    if (keysUnchanged && contentUnchanged) {
      continue;
    }

    profileWrites.push({
      key: `players/${profile.playerId}/profile.json`,
      data: profile
    });
    const decks = buildDecks(acc, generatedAt);
    if (decks) {
      deckWrites.push({
        key: `players/${profile.playerId}/decks.json`,
        data: decks
      });
    } else {
      // This player has no decks this run. If a prior run wrote a
      // players/{id}/decks.json, it's now stale — delete it so expanded rows
      // don't surface last run's decklists (P-23). Deleting an absent key is a
      // harmless no-op.
      deckDeletes.push(`players/${profile.playerId}/decks.json`);
    }
  }

  // Orphan cleanup: players present in the previous manifest but not in this
  // run have dropped out entirely (e.g. their only event was corrected away).
  // Their profile/decks objects stay addressable unless deleted (P-25).
  const orphanDeletes: string[] = [];
  for (const prevId of Object.keys(prevPlayers)) {
    if (!(prevId in manifestPlayers)) {
      orphanDeletes.push(`players/${prevId}/profile.json`, `players/${prevId}/decks.json`);
    }
  }

  index.sort((a, b) => {
    if (b.lastEventDate !== a.lastEventDate) {
      return b.lastEventDate.localeCompare(a.lastEventDate);
    }
    return b.eventCount - a.eventCount;
  });

  // Publication order (Theme A / P-24): write bodies FIRST, then delete stale
  // bodies, then the index that points at them, then the manifest last. A
  // failure mid-run must never leave the index/manifest referencing objects
  // that don't exist yet.
  await batchPutJson(env, [...profileWrites, ...deckWrites], writeConcurrency);
  await batchDelete(env, [...deckDeletes, ...orphanDeletes], writeConcurrency);
  await putJson(env, INDEX_KEY, index);
  await writeSlimIndex(env, index);

  const manifest: PlayerAggregateManifestV2 = {
    generatedAt,
    // Only successfully-loaded slices: a transient R2 fetch failure must not
    // be cached as "covered" — next run's fast-path needs to retry it.
    tournamentKeys: loadedTournamentKeys.slice().sort(),
    players: manifestPlayers,
    fingerprints
  };
  await putJson(env, MANIFEST_KEY, manifest);

  console.info('[playerAggregator] Built player aggregates', {
    profiles: accs.size,
    profilesWritten: profileWrites.length,
    deckFilesWritten: deckWrites.length,
    tournamentsScanned: scanned,
    tournamentsSkipped: skipped
  });

  return {
    index,
    profileCount: accs.size,
    profilesWritten: profileWrites.length,
    tournamentsScanned: scanned,
    tournamentsSkipped: skipped,
    skippedNoChanges: false
  };
}
