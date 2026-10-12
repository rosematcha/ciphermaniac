import { divisionLookup } from './divisions.js';
import { eventTypeOf } from './structure.js';
import { hasStarted } from './rounds.js';
import { DIVISIONS, isDivision, type Pod, type Tournament, type TournamentSettings } from './types.js';
import { attr, children, parseXml } from './xml.js';

function extraValue(entries: readonly [string, string][], name: string): string {
  const xml = entries.find(([key]) => key === name)?.[1];
  return xml ? parseXml(xml).text : '';
}

function importedRound(t: Tournament, pod: Pod, round: Pod['rounds'][number]): Pod['rounds'][number] {
  const fallback = round.status === 'finished' ? 5 : round.status === 'started' ? 4 : 2;
  return {
    ...round,
    stage: Number(t.passthrough?.roundCodes[`${pod.category}:${round.number}`]?.stage ?? round.stage ?? fallback)
  };
}

function supported(attrs: ReadonlyMap<string, string>, mode: string): boolean {
  return (
    ['1', '2', '3'].includes(attrs.get('type') ?? '2') &&
    ['CUSTOM', 'PRERELEASE', 'LEAGUECHALLENGE', 'TCG1DAY'].includes(mode) &&
    (!attrs.has('gametype') || attrs.get('gametype') === 'TRADING_CARD_GAME')
  );
}

function importedSettings(t: Tournament, attrs: ReadonlyMap<string, string>, mode: string): TournamentSettings {
  const extra = t.passthrough?.extraData ?? [];
  const fallbackStage = hasStarted(t) ? 4 : t.pods.length ? 3 : 1;
  return {
    type: Number(attrs.get('type') ?? (eventTypeOf(t) === 'challenge' ? 2 : 3)) as 1 | 2 | 3,
    mode: mode as TournamentSettings['mode'],
    stage: Number(attrs.get('stage') ?? fallbackStage) as TournamentSettings['stage'],
    lessSwiss: extraValue(extra, 'lessswiss') === 'true',
    autoTables: t.passthrough ? extraValue(extra, 'autotablenumber') === 'true' : !t.players.some(p => p.fixedTable),
    overflowTableStart: Number(extraValue(extra, 'overflowtablestart')),
    elapsedSeconds: Number(t.passthrough?.timeElapsed ?? 0)
  };
}

function importedRanges(extra: readonly [string, string][], pod: Pod): NonNullable<Pod['blockedRanges']> {
  const xml = extra.find(([key]) => key === 'blockedranges')?.[1];
  return xml
    ? children(parseXml(xml), 'range').map(range => ({
        start: Number(attr(range, 'starttable')),
        end: Number(attr(range, 'endtable'))
      }))
    : (pod.blockedRanges ?? []);
}

/** A division pod's saved cut is its own division's bracket size. */
function importedCuts(pod: Pod): Pick<Pod, 'divisionCuts'> {
  if (pod.divisionCuts || !isDivision(pod.category)) {
    return {};
  }
  return { divisionCuts: { [pod.category]: { size: pod.cut, playoff3rd4th: pod.playoff3rd4th } } };
}

function importedCutSize(pod: Pod): number {
  return Math.max(pod.cut, ...Object.values(pod.divisionCuts ?? {}).map(cut => cut.size));
}

function importedPod(t: Tournament, pod: Pod): Pod {
  const saved = t.passthrough?.podExtras[pod.category];
  const extra = saved?.extra ?? [];
  const of = divisionLookup(t);
  const counts = Object.fromEntries(DIVISIONS.map(d => [d, pod.playerIds.filter(id => of(id) === d).length]));
  return {
    ...pod,
    ...importedCuts(pod),
    cut: importedCutSize(pod),
    divisionCounts: pod.divisionCounts ?? counts,
    stage: Number(saved?.stage ?? pod.stage ?? 0) as 0 | 1 | 2,
    subgroupCount: Number(extraValue(extra, 'subgroupcount') || pod.subgroupCount || 1),
    additionalRounds: Number(extraValue(extra, 'additionalrounds') || pod.additionalRounds || 0),
    blockedRanges: importedRanges(extra, pod),
    rounds: pod.rounds.map(round => importedRound(t, pod, round))
  };
}

/** Activate lifecycle fields when editing; a plain document read remains lossless. */
export function lifecycleDocument(t: Tournament): Tournament {
  if (t.settings) {
    return t;
  }
  const attrs = new Map(t.passthrough?.rootAttrs ?? []);
  const mode = attrs.get('mode') ?? (eventTypeOf(t) === 'challenge' ? 'LEAGUECHALLENGE' : 'TCG1DAY');
  if (!supported(attrs, mode)) {
    return t;
  }
  return {
    ...t,
    settings: importedSettings(t, attrs, mode),
    pods: t.pods.map(pod => importedPod(t, pod))
  };
}
