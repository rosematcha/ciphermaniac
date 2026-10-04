import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { applyCommand, type Command, type CommandContext } from '../../shared/tournament/commands.ts';
import { emptyTournament } from '../../shared/tournament/create.ts';
import { type Random, seededRandom } from '../../shared/tournament/random.ts';
import { latestRound } from '../../shared/tournament/rounds.ts';
import { parseTdf, writeTdf } from '../../shared/tournament/tdf.ts';
import type { Division, EventType, Pod, Tournament } from '../../shared/tournament/types.ts';
import { parseXml, type XmlElement } from '../../shared/tournament/xml.ts';

const VOLATILE = new Set([
  'startdate',
  'creationdate',
  'lastmodifieddate',
  'timestamp',
  'pairtime',
  'starttime',
  'timeleft',
  'timeelapsed',
  'autotablenumber',
  'overflowtablestart'
]);

function structure(xml: string): XmlElement {
  const normalize = (element: XmlElement): XmlElement => ({
    ...element,
    text: VOLATILE.has(element.name) ? '*' : element.text,
    children: (element.name === 'players' && element.children.every(c => c.children.length === 0)
      ? [...element.children].sort((a, b) => (a.attrs[0]?.[1] ?? '').localeCompare(b.attrs[0]?.[1] ?? ''))
      : element.children
    ).map(normalize)
  });
  return normalize(parseXml(xml));
}

/** Reproduce TOM's persisted random roster, then use independent pairing randomness. */
function rosterRandom(ids: string[], target: string[]): Random {
  const list = [...ids];
  const draws: number[] = [];
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = list.indexOf(target[i]!);
    draws.push((j + 0.5) / (i + 1));
    [list[i], list[j]] = [list[j]!, list[i]!];
  }
  const fallback = seededRandom(83);
  return () => draws.shift() ?? fallback();
}

function run(t: Tournament, command: Command, ctx: CommandContext): Tournament {
  const result = applyCommand(t, command, ctx);
  assert.ok(result.ok, result.ok ? '' : `${command.type}: ${result.error}`);
  return result.tournament;
}

/** Staff can rearrange a Swiss pairing; use that to play TOM's exact match history. */
function alignSwiss(input: Tournament, target: Pod, ctx: CommandContext): Tournament {
  let t = input;
  const seats = (pod: Pod) => latestRound(pod)!.matches.flatMap(m => (m.p2 === null ? [m.p1] : [m.p1, m.p2]));
  const desired = seats(target);
  assert.equal(seats(t.pods[0]!).length, desired.length);
  for (let i = 0; i < desired.length; i += 1) {
    const current = seats(t.pods[0]!)[i]!;
    if (current !== desired[i]) {
      t = run(t, { type: 'swapPlayers', pod: target.category, a: current, b: desired[i]! }, ctx);
    }
  }
  return t;
}

function pairSnapshot(t: Tournament, target: Pod, ctx: CommandContext): Tournament {
  const round = latestRound(target)!;
  const prior = latestRound(t.pods[0]);
  const cut = Object.entries(target.divisionCuts ?? {})[0];
  const command: Command =
    round.kind === 'elimination' && prior?.kind === 'swiss'
      ? {
          type: 'startTopCut',
          pod: target.category,
          size: target.cut || cut?.[1].size || 0,
          ...(cut ? { division: cut[0] as Division } : {})
        }
      : { type: 'pairRound', pod: target.category };
  const paired = run(t, command, ctx);
  return round.kind === 'swiss' ? alignSwiss(paired, target, ctx) : paired;
}

function completeSnapshot(input: Tournament, target: Pod, ctx: CommandContext): Tournament {
  let t = run(input, { type: 'startClock', pod: target.category }, ctx);
  const round = latestRound(target)!;
  for (const match of round.matches.filter(m => m.p2 !== null)) {
    t = run(t, { type: 'reportResult', pod: target.category, round: round.number, ...match }, ctx);
  }
  return t;
}

for (const [scenario, type] of [
  ['cup-solo', 'cup'],
  ['challenge', 'challenge'],
  ['earned-mixed', 'cup'],
  ['earned-challenge', 'challenge']
] as const satisfies readonly (readonly [string, EventType])[]) {
  test(`end to end: ${scenario} ${type} commands match TOM's saves from first pairing through final standings`, () => {
    const directory = new URL(`../fixtures/tdf/harness/${scenario}/`, import.meta.url);
    const saves = readdirSync(directory).map(name => ({ name, xml: readFileSync(new URL(name, directory), 'utf8') }));
    const registered = parseTdf(saves.find(s => s.name.includes('registered'))!.xml);
    const first = parseTdf(saves.find(s => s.name.includes('r1-paired'))!.xml);
    const ctx: CommandContext = {
      now: 0,
      localTime: '',
      season: 2027,
      sanctioned: true,
      random: rosterRandom(
        registered.players.map(p => p.id),
        first.players.map(p => p.id)
      )
    };
    let t = emptyTournament({ ...first.info, eventType: type });
    for (const player of registered.players) {
      t = run(t, { type: 'addPlayer', player }, ctx);
      if (player.byes) {
        t.players.at(-1)!.byes = player.byes;
      }
    }
    for (const save of saves.filter(s => /-(?:r\d+-(?:paired|complete)|final)\.tdf$/.test(s.name))) {
      const reference = parseTdf(save.xml);
      const pod = reference.pods[0]!;
      const round = latestRound(pod)!;
      ctx.localTime = round.startTime || round.pairTime;
      ctx.now = new Date(ctx.localTime).getTime();
      for (const player of reference.players.filter(p => p.droppedAfter !== null)) {
        if (t.players.find(p => p.id === player.id)?.droppedAfter === null) {
          t = run(t, { type: 'dropPlayer', id: player.id }, ctx);
        }
      }
      if (save.name.includes('-paired')) {
        t = pairSnapshot(t, pod, ctx);
      }
      if (save.name.includes('-complete')) {
        t = completeSnapshot(t, pod, ctx);
      }
      assert.deepEqual(
        structure(writeTdf(t, { finalized: save.name.includes('-final'), now: ctx.now })),
        structure(save.xml),
        save.name
      );
    }
  });
}
