import { survivorList } from './lifecycleSurvivors.js';
import { finalPodRound } from './lifecycleWorkflow.js';
import { activeIds, latestRound, seatPairings } from './rounds.js';
import type { Pod, Tournament } from './types.js';

/** A pod whose final round has every result, whichever report acknowledged it. */
function finishedPod(t: Tournament, pod: Pod): boolean {
  const last = latestRound(pod);
  return Boolean(last && (last.stage ?? 0) >= 5 && finalPodRound(t, pod, last));
}

/** Number of active seats still contending for this pod's tables; elimination play counts V18-8's list. */
function tableCount(t: Tournament, pod: Pod): number {
  if (pod.stage === 1 || latestRound(pod)?.kind === 'elimination') {
    return Math.floor(survivorList(t, pod).length / 2);
  }
  return Math.floor(activeIds(t, pod).length / 2);
}

type Categories = ReadonlySet<Pod['category']>;

const runningRound = (pod: Pod): boolean => {
  const stage = latestRound(pod)?.stage ?? 2;
  return stage >= 3 && stage <= 5;
};

/** Pods whose current round is between pairings viewed and complete results keep their stored start. */
export function heldStarts(t: Tournament): Categories {
  return new Set(t.pods.filter(runningRound).map(pod => pod.category));
}

/** Recomputed starts follow active pods in file order; running pods keep their stored start. */
function ranges(t: Tournament, held: Categories = heldStarts(t)): Map<Pod['category'], { start: number; end: number }> {
  let first = 1;
  const result = new Map<Pod['category'], { start: number; end: number }>();
  for (const pod of t.pods) {
    if (finishedPod(t, pod)) {
      continue;
    }
    const start = held.has(pod.category) ? pod.startingTable : first;
    const end = start + tableCount(t, pod) - 1;
    result.set(pod.category, { start, end });
    first = end + 1;
  }
  return result;
}

/** Fresh pairings use recomputed ranges without changing the stored starting table of a terminal attempt. */
export function pairingTableStart(t: Tournament, pod: Pod): number {
  return t.settings?.autoTables ? (ranges(t).get(pod.category)?.start ?? 1) : pod.startingTable;
}

/** Automatic numbering alone has a ceiling, bounded by the next active pod or overflow. */
export function tableCeiling(t: Tournament, pod: Pod): number | undefined {
  if (!t.settings?.autoTables) {
    return undefined;
  }
  const computed = ranges(t);
  // Statement 21b: a single pod's ceiling is the end of its own range, whatever the saved overflow start.
  if (t.pods.length === 1) {
    return computed.get(pod.category)?.end ?? pod.startingTable - 1;
  }
  if (t.settings.overflowTableStart <= 0) {
    return undefined;
  }
  const active = t.pods.filter(p => !finishedPod(t, p));
  const next = active[active.indexOf(pod) + 1];
  return next
    ? Math.min(next.startingTable, computed.get(next.category)!.start) - 1
    : t.settings.overflowTableStart - 1;
}

/** Tables of pods outside a single-pod action, which a moved match cannot take. */
function neighbourTables(t: Tournament, pod: Pod, category: Pod['category'] | undefined): number[] {
  if (category === undefined || t.pods.length < 2) {
    return [];
  }
  return t.pods
    .filter(other => other !== pod)
    .flatMap(
      other =>
        latestRound(other)
          ?.matches.filter(m => m.p2 !== null && m.table > 0 && m.table >= (t.settings?.overflowTableStart ?? 0))
          .map(m => m.table) ?? []
    );
}

/**
 * Pack active pods, retaining tables already inside the assigned range when a free one exists. A repair
 * decides which pods keep their start from the stages before it.
 */
export function packTables(t: Tournament, category?: Pod['category'], held?: Categories): Tournament {
  if (!t.settings?.autoTables) {
    return t;
  }
  const computed = ranges(t, held);
  const pods = t.pods.map(pod => {
    if (finishedPod(t, pod)) {
      return pod;
    }
    const last = latestRound(pod);
    if (!last) {
      return pod;
    }
    const { start: startingTable } = computed.get(pod.category)!;
    const ceiling = tableCeiling(t, pod) ?? Infinity;
    const own = last.matches.filter(m => m.p2 !== null && m.table >= startingTable && m.table <= ceiling);
    const held = new Set([...own.map(m => m.table), ...neighbourTables(t, pod, category)]);
    const moved = last.matches.filter(m => m.p2 !== null && m.table > 0 && !own.includes(m));
    const seated = seatPairings(moved, {
      firstTable: startingTable,
      ceiling,
      overflow: t.settings!.overflowTableStart,
      timestamp: '',
      taken: held
    });
    const matches = last.matches.map(match => {
      const index = moved.indexOf(match);
      return index < 0 ? match : { ...match, table: seated[index]!.table };
    });
    if (category !== undefined && category !== pod.category) {
      return pod;
    }
    return { ...pod, startingTable, rounds: pod.rounds.map(r => (r === last ? { ...r, matches } : r)) };
  });
  return { ...t, pods };
}

/** V23-4: an ordinary repair packs only rounds that have not started. */
export function packRepairTables(t: Tournament, category?: Pod['category']): Tournament {
  const packed = packTables(t, category);
  return {
    ...packed,
    pods: packed.pods.map((pod, i) => ((latestRound(t.pods[i]!)?.stage ?? 2) >= 4 ? t.pods[i]! : pod))
  };
}

/** Release finished pods' table ranges before allocating the next round. */
export function prepareTables(t: Tournament, category?: Pod['category']): Tournament {
  if (!t.settings?.autoTables) {
    return t;
  }
  const computed = ranges(t);
  return {
    ...t,
    pods: t.pods.map(pod => {
      if (finishedPod(t, pod)) {
        return pod;
      }
      const startingTable = computed.get(pod.category)!.start;
      return category === undefined || category === pod.category ? { ...pod, startingTable } : pod;
    })
  };
}
