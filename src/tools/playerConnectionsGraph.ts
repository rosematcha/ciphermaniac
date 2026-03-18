import type { CanonicalMatchRecord, TournamentParticipant } from '../types/index.js';

const DATE_PREFIX_RE = /^\d{4}-\d{2}-\d{2},\s+/;
const WHITESPACE_RE = /\s+/g;
const LEADING_STAGE_MARKER_RE = /^(?:>\s*(?=[a-z0-9-]*\d)[a-z0-9-]{1,12}\s*)+/i;
const LEADING_TABLE_MARKER_RE = /^(?:(?:\d{1,4}\s+)?(?:table|tbl)\s*(?:\d{1,4}\s+)*)+/i;
const LEADING_ROUND_MARKER_RE = /^(?:(?:round|rd)\s*\d{1,3}\s*)+/i;
const LEADING_POSITION_MARKER_RE = /^\d{1,4}\s+(?=[a-z])/i;
const LEADING_SYMBOL_RE = /^[>#:|/\\-]+/;

// Manual identity bridges for known player-id/name inconsistencies across events.
const PLAYER_ID_SYNONYMS: Record<string, string> = {
  '21': '20186'
};

const PLAYER_NAME_SYNONYMS: Record<string, string> = {
  'prin basser': 'Princess Basser',
  'reese lundquist': 'Reese Ferguson'
};

// Fallback bridges when playerId is missing in report rows.
const PLAYER_NAME_TO_CANONICAL_ID: Record<string, string> = {
  'prin basser': '20186',
  'princess basser': '20186',
  'reese lundquist': '17712',
  'reese ferguson': '17712'
};

interface TournamentIndexEntry {
  tournamentId?: string | number | null;
  labsCode?: string | number | null;
}

interface MutableIdentity {
  key: string;
  name: string;
  normalizedName: string;
  playerId: string | null;
  aliasCounts: Map<string, number>;
  appearances: number;
}

export interface PlayerIdentity {
  key: string;
  name: string;
  normalizedName: string;
  playerId: string | null;
  aliases: string[];
  appearances: number;
}

export interface GraphEdge {
  fromKey: string;
  toKey: string;
  tournament: string;
  round: number | null;
  phase: number | null;
  table: number | null;
  outcomeType: string | null;
  fromResult: string | null;
  toResult: string | null;
}

export interface GraphBuildStats {
  tournamentsSeen: number;
  tournamentsDeduped: number;
  tournamentsProcessed: number;
  tournamentsFailed: number;
  participantRows: number;
  canonicalMatchRows: number;
  edgesAdded: number;
  identities: number;
  connectedComponents: number;
  largestComponentSize: number;
  largestComponentShare: number;
  partialFailure: boolean;
}

export interface GraphBuildProgress {
  phase: 'index' | 'graph';
  completed: number;
  total: number;
  tournament: string;
  participantRows?: number;
  canonicalMatchRows?: number;
  edgesAdded?: number;
  identities?: number;
}

export interface PlayerConnectionsGraph {
  identities: Map<string, PlayerIdentity>;
  nameIndex: Map<string, Set<string>>;
  adjacency: Map<string, Map<string, GraphEdge>>;
  pairMatchCounts: Map<string, number>;
  playerMatchCounts: Map<string, number>;
  tournaments: string[];
  stats: GraphBuildStats;
  failures: Array<{ tournament: string; message: string }>;
}

export interface BuildPlayerConnectionsGraphOptions {
  tournaments: string[];
  fetchTournamentIndex: (tournament: string) => Promise<TournamentIndexEntry | null>;
  fetchParticipants: (tournament: string) => Promise<TournamentParticipant[]>;
  fetchMatches: (tournament: string) => Promise<CanonicalMatchRecord[]>;
  concurrency?: number;
  onProgress?: (progress: GraphBuildProgress) => void;
}

export interface ConnectionPathResult {
  status: 'same' | 'connected' | 'disconnected' | 'not_found';
  degree: number | null;
  identities: PlayerIdentity[];
  hops: GraphEdge[];
  missing?: 'source' | 'target' | 'both';
}

export interface GraphInterestingStats {
  averageOpponents: number;
  mostConnectedKey: string | null;
  mostConnectedDegree: number;
  longestRouteEstimate: number;
  mostFrequentPairing: {
    leftKey: string;
    rightKey: string;
    matches: number;
  } | null;
  mostActivePlayerKey: string | null;
  mostActivePlayerMatches: number;
}

interface TournamentCandidate {
  folder: string;
  index: TournamentIndexEntry | null;
}

interface TournamentsByAlias {
  key: string;
  candidate: TournamentCandidate;
}

function normalizeWhitespace(value: string): string {
  return value.replace(WHITESPACE_RE, ' ').trim();
}

/**
 * Remove known report-artifact prefixes from participant names.
 * Example artifacts: ">10 TABLE", ">ST6>", "153 ".
 */
export function sanitizeParticipantName(raw: unknown): string {
  const fallback = normalizeWhitespace(String(raw || ''));
  if (!fallback) {
    return '';
  }

  let value = fallback;
  for (let i = 0; i < 6; i += 1) {
    const next = normalizeWhitespace(
      value
        .replace(LEADING_STAGE_MARKER_RE, '')
        .replace(LEADING_TABLE_MARKER_RE, '')
        .replace(LEADING_ROUND_MARKER_RE, '')
        .replace(LEADING_SYMBOL_RE, '')
        .replace(LEADING_POSITION_MARKER_RE, '')
    );

    if (next === value) {
      break;
    }
    value = next;
  }

  return value || fallback;
}

function canonicalizeParticipantName(raw: unknown): string {
  const cleaned = sanitizeParticipantName(raw);
  if (!cleaned) {
    return '';
  }
  const normalized = normalizePlayerName(cleaned);
  const synonym = PLAYER_NAME_SYNONYMS[normalized];
  return synonym || cleaned;
}

export function normalizePlayerName(raw: unknown): string {
  const normalized = normalizeWhitespace(String(raw || ''));
  if (!normalized) {
    return '';
  }
  return normalized
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(WHITESPACE_RE, ' ')
    .trim();
}

function normalizeTournamentBaseName(raw: string): string {
  const stripped = String(raw || '').replace(DATE_PREFIX_RE, '');
  return normalizeWhitespace(stripped).toLowerCase();
}

function isDatePrefixedTournament(raw: string): boolean {
  return DATE_PREFIX_RE.test(String(raw || '').trim());
}

function getTournamentAliasKey(candidate: TournamentCandidate): string {
  const tournamentId = candidate.index?.tournamentId;
  if (tournamentId !== null && tournamentId !== undefined && String(tournamentId).trim()) {
    return `id:${String(tournamentId).trim()}`;
  }
  const labsCode = candidate.index?.labsCode;
  if (labsCode !== null && labsCode !== undefined && String(labsCode).trim()) {
    return `labs:${String(labsCode).trim()}`;
  }
  return `name:${normalizeTournamentBaseName(candidate.folder)}`;
}

function pickPreferredTournament(existing: TournamentCandidate, incoming: TournamentCandidate): TournamentCandidate {
  const existingHasDate = isDatePrefixedTournament(existing.folder);
  const incomingHasDate = isDatePrefixedTournament(incoming.folder);
  if (incomingHasDate && !existingHasDate) {
    return incoming;
  }
  if (existingHasDate && !incomingHasDate) {
    return existing;
  }
  return existing;
}

function dedupeTournaments(candidates: TournamentCandidate[]): TournamentCandidate[] {
  const byAlias = new Map<string, TournamentCandidate>();
  for (const candidate of candidates) {
    const aliasKey = getTournamentAliasKey(candidate);
    const existing = byAlias.get(aliasKey);
    if (!existing) {
      byAlias.set(aliasKey, candidate);
      continue;
    }
    byAlias.set(aliasKey, pickPreferredTournament(existing, candidate));
  }

  return candidates
    .map(candidate => {
      const aliasKey = getTournamentAliasKey(candidate);
      const selected = byAlias.get(aliasKey);
      if (!selected || selected.folder !== candidate.folder) {
        return null;
      }
      return {
        key: aliasKey,
        candidate
      } satisfies TournamentsByAlias;
    })
    .filter((entry): entry is TournamentsByAlias => Boolean(entry))
    .map(entry => entry.candidate);
}

function toFiniteInt(value: unknown): number | null {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    return null;
  }
  return Math.round(numberValue);
}

function toOptionalString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const text = normalizeWhitespace(String(value));
  return text || null;
}

function toIdentityKey(
  participant: TournamentParticipant,
  normalizedName: string
): { key: string; playerId: string | null } | null {
  const rawPlayerId = toOptionalString(participant.playerId);
  const canonicalPlayerId =
    (rawPlayerId ? PLAYER_ID_SYNONYMS[rawPlayerId] || rawPlayerId : null) ||
    (normalizedName ? PLAYER_NAME_TO_CANONICAL_ID[normalizedName] || null : null);
  if (canonicalPlayerId) {
    return {
      key: `pid:${canonicalPlayerId}`,
      playerId: canonicalPlayerId
    };
  }

  if (!normalizedName) {
    return null;
  }

  return {
    key: `name:${normalizedName}`,
    playerId: null
  };
}

function pickDisplayName(identity: MutableIdentity): string {
  let bestName = identity.name;
  let bestCount = -1;
  identity.aliasCounts.forEach((count, alias) => {
    if (count > bestCount) {
      bestName = alias;
      bestCount = count;
    }
  });
  return bestName;
}

function ensureIdentity(
  mutableIdentities: Map<string, MutableIdentity>,
  nameIndex: Map<string, Set<string>>,
  key: string,
  fallbackName: string,
  normalizedName: string,
  playerId: string | null
): MutableIdentity {
  let identity = mutableIdentities.get(key);
  if (!identity) {
    identity = {
      key,
      name: fallbackName,
      normalizedName,
      playerId,
      aliasCounts: new Map(),
      appearances: 0
    };
    mutableIdentities.set(key, identity);

    if (normalizedName) {
      const bucket = nameIndex.get(normalizedName) || new Set<string>();
      bucket.add(key);
      nameIndex.set(normalizedName, bucket);
    }
  }
  return identity;
}

function makeEdgeKey(fromKey: string, toKey: string): string {
  return fromKey < toKey ? `${fromKey}||${toKey}` : `${toKey}||${fromKey}`;
}

function reverseEdge(edge: GraphEdge): GraphEdge {
  return {
    fromKey: edge.toKey,
    toKey: edge.fromKey,
    tournament: edge.tournament,
    round: edge.round,
    phase: edge.phase,
    table: edge.table,
    outcomeType: edge.outcomeType,
    fromResult: edge.toResult,
    toResult: edge.fromResult
  };
}

function addUndirectedEdge(
  adjacency: Map<string, Map<string, GraphEdge>>,
  uniqueEdgeKeys: Set<string>,
  edge: GraphEdge
): boolean {
  if (!edge.fromKey || !edge.toKey || edge.fromKey === edge.toKey) {
    return false;
  }

  const key = makeEdgeKey(edge.fromKey, edge.toKey);
  if (uniqueEdgeKeys.has(key)) {
    return false;
  }
  uniqueEdgeKeys.add(key);

  const fromNeighbors = adjacency.get(edge.fromKey) || new Map<string, GraphEdge>();
  fromNeighbors.set(edge.toKey, edge);
  adjacency.set(edge.fromKey, fromNeighbors);

  const reverse = reverseEdge(edge);
  const toNeighbors = adjacency.get(reverse.fromKey) || new Map<string, GraphEdge>();
  toNeighbors.set(reverse.toKey, reverse);
  adjacency.set(reverse.fromKey, toNeighbors);

  return true;
}

function buildFinalIdentityMap(mutableIdentities: Map<string, MutableIdentity>): Map<string, PlayerIdentity> {
  const out = new Map<string, PlayerIdentity>();
  mutableIdentities.forEach(identity => {
    const aliases = Array.from(identity.aliasCounts.entries())
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(entry => entry[0]);

    out.set(identity.key, {
      key: identity.key,
      name: pickDisplayName(identity),
      normalizedName: identity.normalizedName,
      playerId: identity.playerId,
      aliases,
      appearances: identity.appearances
    });
  });
  return out;
}

function computeConnectivityStats(
  identityKeys: Iterable<string>,
  adjacency: Map<string, Map<string, GraphEdge>>
): {
  connectedComponents: number;
  largestComponentSize: number;
} {
  const visited = new Set<string>();
  let connectedComponents = 0;
  let largestComponentSize = 0;

  for (const start of identityKeys) {
    if (visited.has(start)) {
      continue;
    }

    connectedComponents += 1;
    let componentSize = 0;
    const queue: string[] = [start];
    visited.add(start);

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        continue;
      }

      componentSize += 1;
      const neighbors = adjacency.get(current);
      if (!neighbors) {
        continue;
      }

      for (const next of neighbors.keys()) {
        if (visited.has(next)) {
          continue;
        }
        visited.add(next);
        queue.push(next);
      }
    }

    if (componentSize > largestComponentSize) {
      largestComponentSize = componentSize;
    }
  }

  return {
    connectedComponents,
    largestComponentSize
  };
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  iteratee: (item: T, index: number) => Promise<void>
): Promise<void> {
  if (!items.length) {
    return;
  }
  const maxWorkers = Math.max(1, Math.min(concurrency, items.length));
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) {
        return;
      }
      // eslint-disable-next-line no-await-in-loop
      await iteratee(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: maxWorkers }, () => worker()));
}

export function isOfflineTournamentFolder(folder: string): boolean {
  const normalized = normalizeWhitespace(String(folder || '')).toLowerCase();
  if (!normalized) {
    return false;
  }
  if (normalized.includes('online - last 14 days')) {
    return false;
  }
  if (normalized.includes('trends - last 30 days')) {
    return false;
  }
  return true;
}

export async function buildPlayerConnectionsGraph(
  options: BuildPlayerConnectionsGraphOptions
): Promise<PlayerConnectionsGraph> {
  const concurrency = Math.max(1, options.concurrency || 4);
  const candidates = (Array.isArray(options.tournaments) ? options.tournaments : [])
    .map(folder => normalizeWhitespace(String(folder || '')))
    .filter(folder => folder && isOfflineTournamentFolder(folder));

  const failures: Array<{ tournament: string; message: string }> = [];
  const failedGraphTournaments = new Set<string>();
  const indexedCandidates: TournamentCandidate[] = [];
  let indexedCompleted = 0;

  await mapWithConcurrency(candidates, concurrency, async (folder, index) => {
    try {
      const indexData = await options.fetchTournamentIndex(folder);
      indexedCandidates[index] = {
        folder,
        index: indexData
      };
    } catch (error) {
      failures.push({
        tournament: folder,
        message: error instanceof Error ? error.message : String(error)
      });
      indexedCandidates[index] = {
        folder,
        index: null
      };
    } finally {
      indexedCompleted += 1;
      options.onProgress?.({
        phase: 'index',
        completed: indexedCompleted,
        total: candidates.length,
        tournament: folder
      });
    }
  });

  const deduped = dedupeTournaments(indexedCandidates.filter(Boolean));

  const mutableIdentities = new Map<string, MutableIdentity>();
  const nameIndex = new Map<string, Set<string>>();
  const adjacency = new Map<string, Map<string, GraphEdge>>();
  const uniqueEdgeKeys = new Set<string>();
  const pairMatchCounts = new Map<string, number>();
  const playerMatchCounts = new Map<string, number>();

  let participantRows = 0;
  let canonicalMatchRows = 0;
  let processed = 0;

  await mapWithConcurrency(deduped, concurrency, async tournament => {
    try {
      const [participants, matches] = await Promise.all([
        options.fetchParticipants(tournament.folder),
        options.fetchMatches(tournament.folder)
      ]);

      const tpToIdentity = new Map<number, string>();

      for (const participant of Array.isArray(participants) ? participants : []) {
        participantRows += 1;

        const cleanedName = canonicalizeParticipantName(participant.name);
        const normalizedName = normalizePlayerName(cleanedName);
        const displayName = cleanedName || 'Unknown Player';
        const identityRef = toIdentityKey(participant, normalizedName);
        if (!identityRef) {
          continue;
        }

        const identity = ensureIdentity(
          mutableIdentities,
          nameIndex,
          identityRef.key,
          displayName,
          normalizedName,
          identityRef.playerId
        );

        identity.appearances += 1;
        identity.aliasCounts.set(displayName, (identity.aliasCounts.get(displayName) || 0) + 1);

        const tpId = toFiniteInt(participant.tpId);
        if (tpId !== null) {
          tpToIdentity.set(tpId, identityRef.key);
        }
      }

      for (const match of Array.isArray(matches) ? matches : []) {
        canonicalMatchRows += 1;

        const p1 = toFiniteInt(match.player1Id);
        const p2 = toFiniteInt(match.player2Id);
        if (p1 === null || p2 === null) {
          continue;
        }

        const fromKey = tpToIdentity.get(p1);
        const toKey = tpToIdentity.get(p2);
        if (!fromKey || !toKey || fromKey === toKey) {
          continue;
        }

        const pairKey = makeEdgeKey(fromKey, toKey);
        pairMatchCounts.set(pairKey, (pairMatchCounts.get(pairKey) || 0) + 1);
        playerMatchCounts.set(fromKey, (playerMatchCounts.get(fromKey) || 0) + 1);
        playerMatchCounts.set(toKey, (playerMatchCounts.get(toKey) || 0) + 1);

        const added = addUndirectedEdge(adjacency, uniqueEdgeKeys, {
          fromKey,
          toKey,
          tournament: tournament.folder,
          round: toFiniteInt(match.round),
          phase: toFiniteInt(match.phase),
          table: toFiniteInt(match.table),
          outcomeType: toOptionalString(match.outcomeType),
          fromResult: toOptionalString(match.player1Result),
          toResult: toOptionalString(match.player2Result)
        });

        if (!added) {
          continue;
        }
      }
    } catch (error) {
      failedGraphTournaments.add(tournament.folder);
      failures.push({
        tournament: tournament.folder,
        message: error instanceof Error ? error.message : String(error)
      });
    } finally {
      processed += 1;
      options.onProgress?.({
        phase: 'graph',
        completed: processed,
        total: deduped.length,
        tournament: tournament.folder,
        participantRows,
        canonicalMatchRows,
        edgesAdded: uniqueEdgeKeys.size,
        identities: mutableIdentities.size
      });
    }
  });

  const finalIdentities = buildFinalIdentityMap(mutableIdentities);
  const connectivityStats = computeConnectivityStats(finalIdentities.keys(), adjacency);
  const largestComponentShare =
    finalIdentities.size > 0 ? connectivityStats.largestComponentSize / finalIdentities.size : 0;

  const stats: GraphBuildStats = {
    tournamentsSeen: candidates.length,
    tournamentsDeduped: deduped.length,
    tournamentsProcessed: deduped.length - failedGraphTournaments.size,
    tournamentsFailed: failures.length,
    participantRows,
    canonicalMatchRows,
    edgesAdded: uniqueEdgeKeys.size,
    identities: finalIdentities.size,
    connectedComponents: connectivityStats.connectedComponents,
    largestComponentSize: connectivityStats.largestComponentSize,
    largestComponentShare,
    partialFailure: failures.length > 0
  };

  return {
    identities: finalIdentities,
    nameIndex,
    adjacency,
    pairMatchCounts,
    playerMatchCounts,
    tournaments: deduped.map(entry => entry.folder),
    stats,
    failures
  };
}

export function findConnectionPath(
  graph: PlayerConnectionsGraph,
  sourceKey: string | null | undefined,
  targetKey: string | null | undefined
): ConnectionPathResult {
  const source = sourceKey ? graph.identities.get(sourceKey) : null;
  const target = targetKey ? graph.identities.get(targetKey) : null;

  if (!source && !target) {
    return {
      status: 'not_found',
      degree: null,
      identities: [],
      hops: [],
      missing: 'both'
    };
  }

  if (!source) {
    return {
      status: 'not_found',
      degree: null,
      identities: [],
      hops: [],
      missing: 'source'
    };
  }

  if (!target) {
    return {
      status: 'not_found',
      degree: null,
      identities: [],
      hops: [],
      missing: 'target'
    };
  }

  if (source.key === target.key) {
    return {
      status: 'same',
      degree: 0,
      identities: [source],
      hops: []
    };
  }

  const queue: string[] = [source.key];
  const visited = new Set<string>([source.key]);
  const parents = new Map<string, { prev: string; edge: GraphEdge }>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    const neighbors = graph.adjacency.get(current);
    if (!neighbors) {
      continue;
    }

    for (const [nextKey, edge] of neighbors.entries()) {
      if (visited.has(nextKey)) {
        continue;
      }
      visited.add(nextKey);
      parents.set(nextKey, {
        prev: current,
        edge
      });

      if (nextKey === target.key) {
        const identities: PlayerIdentity[] = [];
        const hops: GraphEdge[] = [];
        let cursor = nextKey;

        while (cursor !== source.key) {
          const identity = graph.identities.get(cursor);
          if (identity) {
            identities.push(identity);
          }
          const parent = parents.get(cursor);
          if (!parent) {
            break;
          }
          hops.push(parent.edge);
          cursor = parent.prev;
        }

        identities.push(source);
        identities.reverse();
        hops.reverse();

        return {
          status: 'connected',
          degree: hops.length,
          identities,
          hops
        };
      }

      queue.push(nextKey);
    }
  }

  return {
    status: 'disconnected',
    degree: null,
    identities: [source, target],
    hops: []
  };
}

function findFarthestNode(graph: PlayerConnectionsGraph, startKey: string): { key: string; distance: number } {
  if (!graph.identities.has(startKey)) {
    return { key: startKey, distance: 0 };
  }

  const queue: string[] = [startKey];
  const distances = new Map<string, number>([[startKey, 0]]);
  let farthestKey = startKey;
  let farthestDistance = 0;

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    const distance = distances.get(current) || 0;
    if (distance > farthestDistance) {
      farthestDistance = distance;
      farthestKey = current;
    }

    const neighbors = graph.adjacency.get(current);
    if (!neighbors) {
      continue;
    }

    for (const next of neighbors.keys()) {
      if (distances.has(next)) {
        continue;
      }
      distances.set(next, distance + 1);
      queue.push(next);
    }
  }

  return {
    key: farthestKey,
    distance: farthestDistance
  };
}

export function computeGraphInterestingStats(graph: PlayerConnectionsGraph): GraphInterestingStats {
  const identityCount = graph.identities.size;
  if (identityCount === 0) {
    return {
      averageOpponents: 0,
      mostConnectedKey: null,
      mostConnectedDegree: 0,
      longestRouteEstimate: 0,
      mostFrequentPairing: null,
      mostActivePlayerKey: null,
      mostActivePlayerMatches: 0
    };
  }

  let mostConnectedKey: string | null = null;
  let mostConnectedDegree = -1;
  let mostActivePlayerKey: string | null = null;
  let mostActivePlayerMatches = -1;
  let mostFrequentPairing: {
    leftKey: string;
    rightKey: string;
    matches: number;
  } | null = null;

  graph.identities.forEach((_, key) => {
    const degree = graph.adjacency.get(key)?.size || 0;
    if (degree > mostConnectedDegree) {
      mostConnectedDegree = degree;
      mostConnectedKey = key;
    }
  });

  graph.playerMatchCounts.forEach((matches, key) => {
    if (matches > mostActivePlayerMatches) {
      mostActivePlayerMatches = matches;
      mostActivePlayerKey = key;
    }
  });

  graph.pairMatchCounts.forEach((matches, pairKey) => {
    if (!mostFrequentPairing || matches > mostFrequentPairing.matches) {
      const [leftKey = '', rightKey = ''] = pairKey.split('||');
      mostFrequentPairing = {
        leftKey,
        rightKey,
        matches
      };
    }
  });

  const averageOpponents = identityCount > 0 ? (graph.stats.edgesAdded * 2) / identityCount : 0;

  const seedKey = mostConnectedKey || Array.from(graph.identities.keys())[0] || '';
  const firstSweep = seedKey ? findFarthestNode(graph, seedKey) : { key: '', distance: 0 };
  const secondSweep = firstSweep.key ? findFarthestNode(graph, firstSweep.key) : { key: '', distance: 0 };

  return {
    averageOpponents,
    mostConnectedKey,
    mostConnectedDegree: Math.max(0, mostConnectedDegree),
    longestRouteEstimate: secondSweep.distance,
    mostFrequentPairing,
    mostActivePlayerKey,
    mostActivePlayerMatches: Math.max(0, mostActivePlayerMatches)
  };
}
