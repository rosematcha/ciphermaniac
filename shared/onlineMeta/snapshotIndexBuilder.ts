import { loadCardSynonyms } from '../data/cardSynonyms.js';
import { getCanonicalCardFromData } from '../synonyms';
import { cardNumberIndexKey } from '../cardUtils.js';
import { getJson, getJsonResult, putJson } from './storageWriter';

const SNAPSHOT_ROOT = 'reports/Snapshots';
const LIVE_BASE = 'reports/Online - Last 14 Days';

export interface RotationDescriptor {
  /** ISO date YYYY-MM-DD */
  date: string;
  /** Optional human label, surfaced in tooling */
  label?: string;
}

export interface SnapshotIndex {
  generatedAt: string;
  rotations: { date: string; label?: string; snapshotPath: string }[];
  /** Canonical card UID (Name::SET::NUMBER) → rotation date */
  cards: Record<string, string>;
  /** SET::NUMBER (uppercase, leading zeros stripped) → rotation date */
  cardsBySetNumber: Record<string, string>;
  /** Archetype slug (matches archetypes/index.json `name`) → rotation date */
  archetypes: Record<string, string>;
}

interface MinimalCardItem {
  name?: string;
  set?: string;
  number?: string | number;
  uid?: string;
}

interface MinimalMasterPayload {
  items?: MinimalCardItem[];
}

interface MinimalArchetypeIndexEntry {
  name?: string;
}

function itemUid(item: MinimalCardItem): string | null {
  if (item.uid) {
    return item.uid;
  }
  if (item.name && item.set && item.number !== undefined && item.number !== null) {
    return `${item.name}::${item.set}::${item.number}`;
  }
  return null;
}

function setNumberKey(set: string, number: string | number): string {
  // Shared normalization (zero-strip + uppercase suffix) so the keys written
  // here always match the ones the SPA reader builds.
  return `${set.toUpperCase()}::${cardNumberIndexKey(number)}`;
}

/**
 * Read the live master + archetype index to compute the set of currently-active
 * canonical UIDs and archetype slugs. The "canonical wins" rule: a card or
 * archetype present in live data is excluded from the rotation index even if it
 * also appears in a snapshot — its live page will render fine, so no fallback
 * is needed.
 */
async function loadActiveSets(env: unknown, synonymDb: unknown) {
  // Corrupt/unreadable live inputs must ABORT the index rebuild. Treating a
  // parse failure as "no live data" (empty active sets) would classify every
  // live card and archetype as rotated and publish a destructive index (P-16).
  // A genuinely-missing live file is still tolerated as empty — that's the
  // valid "no live data yet" bootstrap state.
  const masterR = await getJsonResult<MinimalMasterPayload>(env, `${LIVE_BASE}/master.json`);
  const indexR = await getJsonResult<MinimalArchetypeIndexEntry[]>(env, `${LIVE_BASE}/archetypes/index.json`);
  if (masterR.status === 'error') {
    throw new Error(
      `[snapshotIndex] Live master.json at ${LIVE_BASE}/master.json is unreadable/corrupt; refusing to rebuild snapshot index (would misclassify all live cards as rotated)`,
      { cause: masterR.error }
    );
  }
  if (indexR.status === 'error') {
    throw new Error(
      `[snapshotIndex] Live archetypes/index.json at ${LIVE_BASE}/archetypes/index.json is unreadable/corrupt; refusing to rebuild snapshot index`,
      { cause: indexR.error }
    );
  }
  const liveMaster = masterR.status === 'ok' ? masterR.value : null;
  const liveIndex = indexR.status === 'ok' ? indexR.value : null;

  const activeCanonicalUids = new Set<string>();
  const activeSetNumber = new Set<string>();
  for (const item of liveMaster?.items ?? []) {
    const uid = itemUid(item);
    if (uid) {
      const canonical = getCanonicalCardFromData(synonymDb as Parameters<typeof getCanonicalCardFromData>[0], uid);
      activeCanonicalUids.add(canonical);
      // Active set/number is recorded from canonical so reprint URLs that
      // resolve to a live canonical are not added back as "rotated" entries.
      const parts = canonical.split('::');
      if (parts.length >= 3 && parts[1] && parts[2]) {
        activeSetNumber.add(setNumberKey(parts[1], parts[2]));
      }
    } else if (item.set && item.number !== undefined && item.number !== null) {
      activeSetNumber.add(setNumberKey(item.set, item.number));
    }
  }

  const activeSlugs = new Set<string>();
  for (const entry of liveIndex ?? []) {
    if (entry?.name) {
      activeSlugs.add(entry.name);
    }
  }

  return { activeCanonicalUids, activeSetNumber, activeSlugs };
}

async function loadSnapshot(env: unknown, rotationDate: string) {
  const master = await getJson<MinimalMasterPayload>(env, `${SNAPSHOT_ROOT}/${rotationDate}/master.json`);
  const index = await getJson<MinimalArchetypeIndexEntry[]>(
    env,
    `${SNAPSHOT_ROOT}/${rotationDate}/archetypes/index.json`
  );
  return { master, index };
}

/**
 * Walk all rotation snapshots (newest first), build a flat lookup index. For
 * each card/archetype, the most-recent snapshot containing it wins — that way
 * a card that rotated, was reprinted, and rotated again maps to its latest
 * appearance. Entries also present in live data are skipped entirely.
 */
export async function rebuildSnapshotIndex(env: unknown, rotations: RotationDescriptor[]): Promise<SnapshotIndex> {
  const synonymDb = await loadCardSynonyms(env as Parameters<typeof loadCardSynonyms>[0]);
  const { activeCanonicalUids, activeSetNumber, activeSlugs } = await loadActiveSets(env, synonymDb);

  // Walk newest-first so first writer wins (= most recent snapshot kept).
  const ordered = [...rotations].sort((a, b) => (a.date < b.date ? 1 : -1));

  const cards: Record<string, string> = {};
  const cardsBySetNumber: Record<string, string> = {};
  const archetypes: Record<string, string> = {};
  const rotationEntries: SnapshotIndex['rotations'] = [];

  for (const rotation of ordered) {
    const { master, index } = await loadSnapshot(env, rotation.date);
    if (!master?.items && !index?.length) {
      console.warn(`[snapshotIndex] No data for ${rotation.date}; skipping`);
      continue;
    }
    rotationEntries.push({
      date: rotation.date,
      ...(rotation.label ? { label: rotation.label } : {}),
      snapshotPath: `Snapshots/${rotation.date}`
    });

    for (const item of master?.items ?? []) {
      const uid = itemUid(item);
      if (uid) {
        const canonical = getCanonicalCardFromData(synonymDb, uid);
        if (activeCanonicalUids.has(canonical)) {
          continue;
        }
        if (!(canonical in cards)) {
          cards[canonical] = rotation.date;
        }
        const parts = canonical.split('::');
        if (parts.length >= 3 && parts[1] && parts[2]) {
          const key = setNumberKey(parts[1], parts[2]);
          if (!activeSetNumber.has(key) && !(key in cardsBySetNumber)) {
            cardsBySetNumber[key] = rotation.date;
          }
        }
      } else if (item.set && item.number !== undefined && item.number !== null) {
        // Cards without a name field (rare/defensive). Index by set/number only.
        const key = setNumberKey(item.set, item.number);
        if (!activeSetNumber.has(key) && !(key in cardsBySetNumber)) {
          cardsBySetNumber[key] = rotation.date;
        }
      }
    }

    for (const entry of index ?? []) {
      const slug = entry?.name;
      if (!slug) {
        continue;
      }
      if (activeSlugs.has(slug)) {
        continue;
      }
      if (!(slug in archetypes)) {
        archetypes[slug] = rotation.date;
      }
    }
  }

  const indexPayload: SnapshotIndex = {
    generatedAt: new Date().toISOString(),
    rotations: rotationEntries,
    cards,
    cardsBySetNumber,
    archetypes
  };

  await putJson(env, `${SNAPSHOT_ROOT}/index.json`, indexPayload, { pretty: true });
  console.info(
    `[snapshotIndex] Wrote index: ${Object.keys(cards).length} cards, ${Object.keys(cardsBySetNumber).length} set::number, ${Object.keys(archetypes).length} archetypes across ${rotationEntries.length} rotations`
  );

  return indexPayload;
}
