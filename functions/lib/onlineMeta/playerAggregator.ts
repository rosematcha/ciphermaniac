import { normalizeArchetypeName, sanitizeForFilename } from '../data/reportBuilder.js';
import { runWithConcurrency } from './tournamentFetcher';
import { batchPutJson, getJson, putJson } from './storageWriter';
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
}

const DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})/;
const MANIFEST_KEY = 'players/_manifest.json';
const INDEX_KEY = 'players/index.json';
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
  const [participants, decks, meta] = await Promise.all([
    getJson<ParticipantRow[]>(env, `${base}/players.json`),
    getJson<DeckRow[]>(env, `${base}/decks.json`),
    getJson<MetaRow>(env, `${base}/meta.json`)
  ]);
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
    totalPlayers: Number.isFinite(totalPlayers) ? Number(totalPlayers) : null
  };
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

  const previousManifest = options.forceFullRebuild ? null : await getJson<PlayerAggregateManifest>(env, MANIFEST_KEY);

  // Fast path: if the tournament set matches the last run exactly, skip the
  // rebuild entirely. The manifest comparison treats both sides as sets so
  // we're not order-sensitive.
  const currentSorted = [...tournamentList].sort();
  const prevSorted = previousManifest?.tournamentKeys ? [...previousManifest.tournamentKeys].sort() : null;
  if (previousManifest && prevSorted && arrayEquals(currentSorted, prevSorted)) {
    console.info('[playerAggregator] Tournament set unchanged; skipping rebuild', {
      tournaments: currentSorted.length
    });
    const index = (await getJson<PlayerIndexEntry[]>(env, INDEX_KEY)) ?? [];
    return {
      index,
      profileCount: Object.keys(previousManifest.players).length,
      profilesWritten: 0,
      tournamentsScanned: 0,
      tournamentsSkipped: 0,
      skippedNoChanges: true
    };
  }

  const slices = await runWithConcurrency(tournamentList, sliceConcurrency, (key: string) =>
    loadTournamentSlice(env, key).catch(err => {
      console.warn(`[playerAggregator] Failed to load slice ${key}`, err);
      return null;
    })
  );

  const accs = new Map<string, Accumulator>();
  const loadedTournamentKeys: string[] = [];
  let skipped = 0;
  let scanned = 0;

  for (const slice of slices) {
    if (!slice) {
      skipped += 1;
      continue;
    }
    scanned += 1;
    loadedTournamentKeys.push(slice.key);

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
  const manifestPlayers: Record<string, string[]> = {};
  const prevPlayers = previousManifest?.players ?? {};

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

    // Incremental skip: if this player's tournament set is unchanged from the
    // last run AND the profile already exists, skip the write.
    const prevKeys = prevPlayers[acc.playerId];
    const unchanged = prevKeys && arrayEquals(tournamentKeys, [...prevKeys].sort());
    if (unchanged) {
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
    }
  }

  index.sort((a, b) => {
    if (b.lastEventDate !== a.lastEventDate) {
      return b.lastEventDate.localeCompare(a.lastEventDate);
    }
    return b.eventCount - a.eventCount;
  });

  await putJson(env, INDEX_KEY, index);
  await batchPutJson(env, [...profileWrites, ...deckWrites], writeConcurrency);

  const manifest: PlayerAggregateManifest = {
    generatedAt,
    // Only successfully-loaded slices: a transient R2 fetch failure must not
    // be cached as "covered" — next run's fast-path needs to retry it.
    tournamentKeys: loadedTournamentKeys.slice().sort(),
    players: manifestPlayers
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
