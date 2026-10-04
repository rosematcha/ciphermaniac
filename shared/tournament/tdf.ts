/**
 * TOM's .tdf files, read into a Tournament and written back out.
 *
 * The format has no published schema; .scratch research and real files are
 * the reference. What matters for writing:
 *
 * - TOM writes from templates, not a serializer, so its spacing is not
 *   uniform (`<player1 userid="1"/>` but `<player userid="1" />` in a roster,
 *   and a stray space in `<round ... stage="6" >`). The writer copies it
 *   for new files. Older TOM layouts may have their whitespace normalized.
 * - Outcome codes: 0 open, 1 and 2 a win for that seat, 3 a tie, 5 a bye,
 *   8 a forced loss (a late entrant's missed round), 10 a double loss. A bye
 *   and a forced loss name one `<player>` at table 0.
 * - Round type 1 is single elimination; a Swiss round repeats the root type
 *   (2 for a League Challenge, 3 for a Cup). Stage 2 is paired, 4 started,
 *   6 records viewed, and 8 standings viewed at the end of Swiss or the cut.
 * - Pod categories: 0 Juniors, 1 Seniors, 2 Masters, 8 Juniors and Seniors,
 *   9 Seniors and Masters, 10 everyone.
 * - `<standings>` is written only once the event is finalized (root stage 5).
 *
 * Anything else TOM put in the file rides along in `passthrough` as XML, so
 * writing an imported file changes only what the site changed.
 */

import { divisionLookup, yearOnlyBirthDate } from './divisions.js';
import { divisionsOf } from './podding.js';
import { attendees, cutPodOf, fullRoundSeconds, hasStarted, normalizeCutPods, regularRounds } from './rounds.js';
import { bracketMatches, placeFinals, swissStandings } from './standings.js';
import { eventTypeOf, recommendedStructure } from './structure.js';
import {
  type Division,
  DIVISIONS,
  type EventType,
  isDivision,
  type Match,
  type Outcome,
  type Player,
  type Pod,
  type PodCategory,
  type Round,
  type RoundStatus,
  type TdfPassthrough,
  type Tournament,
  type TournamentInfo
} from './types.js';
import { attr, child, children, childText, encodeEntities, parseXml, type XmlElement } from './xml.js';

const OUTCOME_CODES: Record<Outcome, string> = {
  pending: '0',
  p1: '1',
  p2: '2',
  tie: '3',
  'assigned-bye': '4',
  bye: '5',
  deleted: '9',
  loss: '8',
  'double-loss': '10'
};
const OUTCOMES_BY_CODE = new Map(Object.entries(OUTCOME_CODES).map(([outcome, code]) => [code, outcome as Outcome]));

const CATEGORY_CODES: Record<PodCategory, string> = {
  junior: '0',
  senior: '1',
  masters: '2',
  'junior-senior': '8',
  'senior-masters': '9',
  mixed: '10'
};
const CATEGORIES_BY_CODE = new Map(
  Object.entries(CATEGORY_CODES).map(([category, code]) => [code, category as PodCategory])
);

const ELIMINATION_TYPE = '1';
const STAGE_PLAYING = '2';
const STAGE_FINISHED = '6';
const STAGE_FINAL = '8';
const FINALIZED = '5';
const FINISHED_STAGES = new Set(['5', STAGE_FINISHED, STAGE_FINAL]);

/** TOM's root and Swiss round type, and its mode, for each kind of event. */
const EVENT_CODES: Record<EventType, { type: string; mode: string }> = {
  cup: { type: '3', mode: 'TCG1DAY' },
  challenge: { type: '2', mode: 'LEAGUECHALLENGE' }
};

/** What a new file says about itself: TOM 1.86, a League Cup or League Challenge. */
export function defaultRootAttrs(type: EventType, configured = true): [string, string][] {
  return [
    ['type', configured ? EVENT_CODES[type].type : '2'],
    ['stage', '1'],
    ['version', '1.86'],
    ['gametype', 'TRADING_CARD_GAME'],
    ['mode', EVENT_CODES[type].mode]
  ];
}

// ---------- reading ----------

/**
 * A code TOM writes, as the model names it. An unknown one is refused rather
 * than guessed: reading it as something else would write it back changed.
 */
function known<T>(codes: ReadonlyMap<string, T>, code: string, what: string): T {
  const value = codes.get(code);
  if (value === undefined) {
    throw new Error(`Unknown ${what} "${code}"`);
  }
  return value;
}

const INFO_TAGS = new Set([
  'name',
  'id',
  'city',
  'state',
  'country',
  'roundtime',
  'finalsroundtime',
  'organizer',
  'startdate'
]);
const PLAYER_TAGS = new Set(['firstname', 'lastname', 'birthdate']);
const PODDATA_TAGS = new Set(['startingtable', 'playoff3rd4th']);

/** Any element as TOM would write it, at depth 0; `indent` shifts it into place. */
export function serializeElement(element: XmlElement): string {
  const { name, children, text } = element;
  const attrs = element.attrs.map(([key, value]) => ` ${key}="${encodeEntities(value)}"`).join('');
  if (name === 'player' && children.length === 0 && !text) {
    return `<player${attrs} />`;
  }
  const content = children.length
    ? ['', ...children.map(child => indent(serializeElement(child), 1)), ''].join('\n')
    : encodeEntities(text) || '\n';
  return `<${name}${attrs}>${content}</${name}>`;
}

function indent(xml: string, depth: number): string {
  const tabs = '\t'.repeat(depth);
  return tabs + xml.replace(/\n/g, `\n${tabs}`);
}

function extras(element: XmlElement | undefined, known: ReadonlySet<string>): [string, string][] {
  return (element?.children ?? []).filter(c => !known.has(c.name)).map(c => [c.name, serializeElement(c)]);
}

const int = (value: string, fallback = 0) => {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : fallback;
};

/**
 * TOM's mode names the kind of event; its type (2 or 3) only says whether
 * Swiss rounds lead to a cut, and Custom and Prerelease events write 2 too.
 */
function readInfo(data: XmlElement | undefined, mode: string): TournamentInfo {
  const organizer = child(data, 'organizer');
  return {
    ...(mode === EVENT_CODES.challenge.mode ? { eventType: 'challenge' as const } : {}),
    name: childText(data, 'name'),
    sanctionId: childText(data, 'id'),
    city: childText(data, 'city'),
    state: childText(data, 'state'),
    country: childText(data, 'country'),
    roundTime: int(childText(data, 'roundtime')),
    finalsRoundTime: int(childText(data, 'finalsroundtime')),
    organizerPopId: attr(organizer, 'popid'),
    organizerName: attr(organizer, 'name'),
    startDate: childText(data, 'startdate')
  };
}

function readPlayer(element: XmlElement): Player {
  const dropped = child(element, 'dropped');
  const late = child(element, 'late');
  const droppedRound = dropped && childText(dropped, 'status') !== '0' ? int(childText(dropped, 'round')) : null;
  return {
    id: attr(element, 'userid'),
    firstName: childText(element, 'firstname'),
    lastName: childText(element, 'lastname'),
    birthDate: yearOnlyBirthDate(childText(element, 'birthdate')),
    droppedAfter: droppedRound,
    starter: childText(element, 'starter') === 'true',
    ...(late?.children.length || late?.text === 'true' || childText(element, 'starter') === 'false'
      ? { late: true }
      : {}),
    ...(late?.children.length
      ? {
          lateData: {
            round: int(childText(late, 'round'), -1),
            timestamp: childText(late, 'timestamp'),
            forcedLoss: childText(late, 'forcedloss') === 'true',
            usedForcedLoss: childText(late, 'usedforcedloss') === 'true'
          }
        }
      : {}),
    ...(childText(dropped, 'status') === '2' ? { disqualified: true as const } : {}),
    ...readPlayerNumbers(element),
    created: childText(element, 'creationdate'),
    modified: childText(element, 'lastmodifieddate')
  };
}

const PLAYER_NUMBERS = [
  ['staticseat', 'fixedTable'],
  ['order', 'order'],
  ['seed', 'seed'],
  ['byes', 'byes']
] as const;

function readPlayerNumbers(element: XmlElement): Partial<Player> {
  return Object.fromEntries(
    PLAYER_NUMBERS.filter(([tag]) => child(element, tag)).map(([tag, key]) => [key, int(childText(element, tag))])
  );
}

function readMatch(element: XmlElement): Match {
  const single = child(element, 'player');
  return {
    table: int(childText(element, 'tablenumber')),
    p1: attr(single ?? child(element, 'player1'), 'userid'),
    p2: single ? null : attr(child(element, 'player2'), 'userid') || null,
    outcome: known(
      OUTCOMES_BY_CODE,
      attr(element, 'outcome') === '6' ? '10' : attr(element, 'outcome'),
      'match outcome'
    ),
    timestamp: childText(element, 'timestamp')
  };
}

function roundStatus(stage: string, matches: readonly Match[], startTime: string): RoundStatus {
  if (FINISHED_STAGES.has(stage) || (matches.length > 0 && matches.every(m => m.outcome !== 'pending'))) {
    return 'finished';
  }
  return startTime || stage === '4' || matches.some(m => m.p2 !== null && m.outcome !== 'pending')
    ? 'started'
    : 'paired';
}

function readRound(element: XmlElement): Round {
  const matches = children(child(element, 'matches'), 'match').map(readMatch);
  const startTime = childText(element, 'starttime');
  return {
    number: int(attr(element, 'number')),
    kind: attr(element, 'type') === ELIMINATION_TYPE ? 'elimination' : 'swiss',
    status: roundStatus(attr(element, 'stage'), matches, startTime),
    timeLeft: int(childText(element, 'timeleft')),
    pairTime: childText(element, 'pairtime'),
    startTime,
    clockStartedAt: null,
    matches
  };
}

const categoryOf = (pod: XmlElement): PodCategory => known(CATEGORIES_BY_CODE, attr(pod, 'category'), 'pod category');

/** TOM's own type and stage for every round, so a round the site did not touch is written back as it was. */
function roundCodesOf(pods: readonly XmlElement[]): TdfPassthrough['roundCodes'] {
  return Object.fromEntries(
    pods.flatMap(pod =>
      children(child(pod, 'rounds'), 'round').map(round => [
        `${categoryOf(pod)}:${attr(round, 'number')}`,
        {
          type: attr(round, 'type'),
          stage: attr(round, 'stage'),
          timeLeft: int(childText(round, 'timeleft')),
          startTime: childText(round, 'starttime')
        }
      ])
    )
  );
}

function readPod(element: XmlElement): Pod {
  const category = categoryOf(element);
  const poddata = child(element, 'poddata');
  const rounds = children(child(element, 'rounds'), 'round');
  return {
    category,
    playerIds: children(child(element, 'subgroups'), 'subgroup').flatMap(subgroup =>
      children(child(subgroup, 'players'), 'player').map(player => attr(player, 'userid'))
    ),
    rounds: rounds.map(readRound),
    cut: 0,
    playoff3rd4th: childText(poddata, 'playoff3rd4th') === 'true',
    startingTable: int(childText(poddata, 'startingtable'), 1)
  };
}

/** Top-cut sizes live in `<finalsoptions>`, keyed by division; a pod takes its division's. */
function applyCuts(pods: Pod[], finals: XmlElement | undefined): Pod[] {
  const cuts = new Map(children(finals, 'categorycut').map(cut => [attr(cut, 'key'), int(childText(cut, 'cut'))]));
  return linkCuts(
    pods.map(pod => ({
      ...pod,
      cut: cuts.get(CATEGORY_CODES[pod.category]) ?? 0,
      ...(!isDivision(pod.category)
        ? {
            divisionCuts: Object.fromEntries(
              divisionsOf(pod.category)
                .filter(d => (cuts.get(CATEGORY_CODES[d]) ?? 0) > 0)
                .map(d => [d, { size: cuts.get(CATEGORY_CODES[d]) ?? 0, playoff3rd4th: pod.playoff3rd4th }])
            )
          }
        : {})
    }))
  );
}

/**
 * A pod of one division that plays only single-elimination rounds, all its
 * players from a pod that plays several divisions, is that division's top
 * cut out of it in older site files. Normalize that layout into TOM's shared
 * round list; new files never write separate division cut pods.
 */
function linkCuts(pods: Pod[]): Pod[] {
  return pods.map(pod => {
    const cutOnly =
      isDivision(pod.category) && pod.rounds.length > 0 && pod.rounds.every(r => r.kind === 'elimination');
    const from =
      cutOnly &&
      pods.find(
        other =>
          !isDivision(other.category) &&
          divisionsOf(other.category).includes(pod.category as Division) &&
          pod.playerIds.every(id => other.playerIds.includes(id))
      );
    return from ? { ...pod, cutOf: from.category } : pod;
  });
}

/** The sections every file TOM saves has, even before anyone registers. */
const REQUIRED_SECTIONS = ['data', 'players', 'pods'];

/** Reads a .tdf. Throws when the file is not XML or not a TOM tournament. */
export function parseTdf(source: string): Tournament {
  const root = parseXml(source);
  if (root.name !== 'tournament' || REQUIRED_SECTIONS.some(name => !child(root, name))) {
    throw new Error('Not a TOM tournament file');
  }
  const data = child(root, 'data');
  const playerElements = children(child(root, 'players'), 'player');
  const podElements = children(child(root, 'pods'), 'pod');
  const finals = child(root, 'finalsoptions');
  let tournament: Tournament = {
    info: readInfo(data, attr(root, 'mode')),
    players: playerElements.map(readPlayer),
    pods: applyCuts(podElements.map(readPod), finals),
    passthrough: {
      rootAttrs: root.attrs,
      extraData: extras(data, INFO_TAGS),
      timeElapsed: childText(root, 'timeelapsed'),
      playerExtras: Object.fromEntries(playerElements.map(p => [attr(p, 'userid'), extras(p, PLAYER_TAGS)])),
      podExtras: Object.fromEntries(
        podElements.map(pod => [
          categoryOf(pod),
          { stage: attr(pod, 'stage'), extra: extras(child(pod, 'poddata'), PODDATA_TAGS) }
        ])
      ),
      roundCodes: roundCodesOf(podElements),
      finalsOptions: finals ? serializeElement(finals) : ''
    }
  };
  const legacy = tournament.pods.some(p => p.cutOf);
  tournament = normalizeCutPods(tournament);
  tournament = completePods(tournament, Number(attr(root, 'stage')) >= 4, finals);
  const standings = child(root, 'standings');
  if (standings && tournament.passthrough && !legacy) {
    tournament.passthrough.standings = { xml: serializeElement(standings), state: standingsState(tournament) };
  }
  if (tournament.passthrough) {
    tournament.passthrough.finalsState = finalsState(tournament);
    if (legacy) {
      tournament.passthrough.finalsOptions = '';
    } else {
      tournament.passthrough.original = { xml: source, state: comparable(tournament) };
    }
  }
  return tournament;
}

function completePods(t: Tournament, started: boolean, finals: XmlElement | undefined): Tournament {
  const of = divisionLookup(t);
  const counts = new Map(children(finals, 'categorycut').map(c => [attr(c, 'key'), int(childText(c, 'playercount'))]));
  const starting = new Set(t.players.filter(p => p.starter).map(p => p.id));
  const pods = t.pods.map(pod => {
    const playerIds = pod.playerIds.length
      ? pod.playerIds
      : t.players.filter(p => divisionsOf(pod.category).includes(of(p.id))).map(p => p.id);
    const divisionCounts = Object.fromEntries(
      divisionsOf(pod.category).map(d => [
        d,
        counts.get(CATEGORY_CODES[d]) ?? playerIds.filter(id => starting.has(id) && of(id) === d).length
      ])
    );
    const divisionCuts =
      pod.divisionCuts &&
      Object.fromEntries(
        Object.entries(pod.divisionCuts).map(([d, cut]) => [
          d,
          { ...cut, playerIds: cut.playerIds ?? playerIds.filter(id => of(id) === d) }
        ])
      );
    return {
      ...pod,
      playerIds,
      ...(started ? { startingPlayerIds: playerIds.filter(id => starting.has(id)), divisionCounts } : {}),
      ...(divisionCuts ? { divisionCuts } : {})
    };
  });
  return { ...t, pods };
}

/** Stable comparison of plain tournament data across wire validation's property order. */
function comparable(value: unknown): string {
  return JSON.stringify(value, (key, entry: unknown) => {
    if (['original', 'timeLeft', 'startTime', 'clockStartedAt'].includes(key)) {
      return undefined;
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return entry;
    }
    const record = entry as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map(key => [key, record[key]])
    );
  });
}

function finalsState(t: Tournament): string {
  return JSON.stringify([
    t.info.eventType,
    t.players.map(p => [p.id, p.birthDate, p.starter]),
    t.pods.map(p => [
      p.category,
      p.playerIds,
      p.cut,
      p.divisionCuts,
      p.playoff3rd4th,
      p.rounds.filter(r => r.kind === 'elimination').map(r => [r.number, r.matches.map(m => [m.p1, m.p2])])
    ])
  ]);
}

/** Only changes that can affect final places invalidate TOM's saved standings. */
function standingsState(t: Tournament): string {
  return JSON.stringify(
    [t.info.startDate, t.players, t.pods],
    [
      'id',
      'birthDate',
      'firstName',
      'lastName',
      'droppedAfter',
      'disqualified',
      'late',
      'category',
      'playerIds',
      'rounds',
      'number',
      'kind',
      'matches',
      'p1',
      'p2',
      'outcome'
    ]
  );
}

// ---------- writing ----------

const esc = encodeEntities;

function tag(name: string, value: string | number): string {
  return `<${name}>${esc(String(value))}</${name}>`;
}

/** A block of lines at `depth`, each already written at depth 0. */
function block(depth: number, lines: readonly string[]): string[] {
  return lines.map(line => indent(line, depth));
}

const NEW_FILE_DATA = [
  '<lessswiss>false</lessswiss>',
  '<autotablenumber>false</autotablenumber>',
  '<overflowtablestart>0</overflowtablestart>'
];

function writeData(t: Tournament): string[] {
  const { info } = t;
  const extra = t.passthrough?.extraData.map(([, xml]) => xml) ?? NEW_FILE_DATA;
  return [
    '<data>',
    ...block(1, [
      tag('name', info.name),
      tag('id', info.sanctionId),
      tag('city', info.city),
      tag('state', info.state),
      tag('country', info.country),
      tag('roundtime', info.roundTime),
      tag('finalsroundtime', info.finalsRoundTime),
      `<organizer popid="${esc(info.organizerPopId)}" name="${esc(info.organizerName)}"/>`,
      tag('startdate', info.startDate),
      ...extra
    ]),
    '</data>'
  ];
}

function writeDrop(player: Player, extra: [string, string][]): string[] {
  if (player.droppedAfter === null) {
    return [];
  }
  const saved = extra.find(([name]) => name === 'dropped')?.[1] ?? '';
  const drop = saved ? parseXml(saved) : undefined;
  if (
    drop &&
    childText(drop, 'status') === (player.disqualified ? '2' : '1') &&
    childText(drop, 'round') === String(player.droppedAfter)
  ) {
    return [saved];
  }
  return [
    '<dropped>',
    ...block(1, [
      tag('status', player.disqualified ? 2 : 1),
      tag('round', player.droppedAfter),
      tag('timestamp', player.modified)
    ]),
    '</dropped>'
  ];
}

function writeLate(player: Player): string[] {
  if (!player.late) {
    return [];
  }
  const late = player.lateData ?? { round: -1, timestamp: player.created, forcedLoss: false, usedForcedLoss: true };
  return [
    '<late>',
    ...block(1, [
      tag('round', late.round),
      tag('timestamp', late.timestamp),
      tag('forcedloss', String(late.forcedLoss)),
      tag('usedforcedloss', String(!late.forcedLoss || late.usedForcedLoss))
    ]),
    '</late>'
  ];
}

const KNOWN_PLAYER_FIELDS = new Set([
  'starter',
  'staticseat',
  'order',
  'seed',
  'byes',
  'late',
  'dropped',
  'creationdate',
  'lastmodifieddate'
]);

function playerFields(player: Player, extra: [string, string][], started: boolean): string[] {
  const starter = player.starter ?? (started && !player.late);
  return [
    ...(starter ? [tag('starter', 'true')] : []),
    ...PLAYER_NUMBERS.flatMap(([name, key]) => (player[key] ? [tag(name, player[key]!)] : [])),
    ...writeLate(player),
    ...writeDrop(player, extra),
    ...extra.filter(([name]) => !KNOWN_PLAYER_FIELDS.has(name)).map(([, xml]) => xml),
    tag('creationdate', player.created),
    tag('lastmodifieddate', player.modified)
  ];
}

function birthYearDate(date: string): string {
  const year = /(?:^|\/)(\d{4})$/.exec(date)?.[1];
  return year ? `02/27/${year}` : date;
}

function writePlayer(player: Player, extra: [string, string][], started: boolean, preserved = false): string[] {
  return [
    `<player userid="${esc(player.id)}">`,
    ...block(1, [
      tag('firstname', player.firstName),
      tag('lastname', player.lastName),
      tag('birthdate', birthYearDate(player.birthDate)),
      ...(preserved ? extra.map(([, xml]) => xml) : playerFields(player, extra, started))
    ]),
    '</player>'
  ];
}

function seatAttr(table: number | undefined): string {
  return table ? ` staticseat="${table}"` : '';
}

function writeMatch(match: Match, fixed: ReadonlyMap<string, number>): string[] {
  const seats =
    match.p2 === null
      ? [`<player userid="${esc(match.p1)}"/>`]
      : [
          `<player1 userid="${match.p1}"${seatAttr(fixed.get(match.p1))}/>`,
          `<player2 userid="${match.p2}"${seatAttr(fixed.get(match.p2))}/>`
        ];
  return [
    `<match outcome="${OUTCOME_CODES[match.outcome]}">`,
    ...block(1, [...seats, tag('timestamp', match.timestamp), tag('tablenumber', match.p2 === null ? 0 : match.table)]),
    '</match>'
  ];
}

interface RoundContext {
  swissType: string;
  finalized: boolean;
  last: boolean;
  lastSwiss: boolean;
  finalCut: boolean;
  now: number;
  fullTime: number;
  preserveClock: boolean;
  fixed: ReadonlyMap<string, number>;
  codes: TdfPassthrough['roundCodes'][string] | undefined;
}

function playingStage(round: Round, kept: string | undefined): string {
  return round.startedAt !== undefined
    ? '4'
    : kept && !FINISHED_STAGES.has(kept)
      ? kept
      : round.startTime
        ? '4'
        : STAGE_PLAYING;
}

function roundStage(round: Round, context: RoundContext): string {
  const kept = context.codes?.stage;
  const complete =
    round.status === 'finished' || (round.matches.length > 0 && round.matches.every(m => m.outcome !== 'pending'));
  if (!complete) {
    return playingStage(round, kept);
  }
  if ((context.finalized && context.last) || context.lastSwiss || context.finalCut) {
    return STAGE_FINAL;
  }
  // A finished round keeps TOM's own finished code; one the site finished gets the usual one.
  return kept && FINISHED_STAGES.has(kept) ? kept : STAGE_FINISHED;
}

function exportTimeLeft(round: Round, context: RoundContext): number {
  if (!round.startTime || (context.preserveClock && round.startedAt === undefined)) {
    return round.timeLeft;
  }
  const start = round.startedAt ?? Date.parse(round.startTime.replace(/^(\d{2})\/(\d{2})\/(\d{4}) /, '$3-$1-$2T'));
  if (!Number.isFinite(start)) {
    return Math.max(0, round.timeLeft);
  }
  return Math.max(0, context.fullTime - Math.trunc((context.now - start) / 1000));
}

function writeRound(round: Round, context: RoundContext): string[] {
  const type = round.kind === 'elimination' ? ELIMINATION_TYPE : (context.codes?.type ?? context.swissType);
  const matches = round.matches.flatMap(m => writeMatch(m, context.fixed));
  const held = context.preserveClock && round.startedAt === undefined ? context.codes : undefined;
  return [
    `<round number="${round.number}" type="${type}" stage="${roundStage(round, context)}" >`,
    ...block(1, [
      tag('timeleft', held?.timeLeft ?? exportTimeLeft(round, context)),
      tag('pairtime', round.pairTime),
      tag('starttime', held?.startTime ?? round.startTime),
      '<matches>',
      ...block(1, matches),
      '</matches>'
    ]),
    '</round>'
  ];
}

const NEW_POD_EXTRAS = [
  '<subgroupcount>1</subgroupcount>',
  '<additionalrounds>0</additionalrounds>',
  '<blockedranges>\n</blockedranges>'
];

function isFinalCutRound(pod: Pod, round: Round): boolean {
  if (round.kind !== 'elimination') {
    return false;
  }
  const cuts = Object.values(pod.divisionCuts ?? {});
  if (!cuts.length) {
    return bracketMatches(pod, round).length === 1;
  }
  const swiss = pod.rounds.filter(r => r.kind === 'swiss').at(-1)?.number ?? 0;
  return round.number - swiss >= Math.max(...cuts.map(c => Math.log2(c.size)));
}

interface PodSave {
  finalized: boolean;
  now: number;
  preserveClock: boolean;
}

function writePodRounds(t: Tournament, pod: Pod, save: PodSave): string[] {
  const { finalized, now, preserveClock } = save;
  const swissType = rootValue(t, 'type') ?? EVENT_CODES[eventTypeOf(t)].type;
  const swiss = pod.rounds.filter(r => r.kind === 'swiss');
  const hasCut = pod.rounds.some(r => r.kind === 'elimination');
  const lastSwiss = hasCut || swiss.length >= plannedSwiss(t, pod) ? swiss.at(-1)?.number : undefined;
  const fixed = new Map(t.players.flatMap(p => (p.fixedTable ? [[p.id, p.fixedTable] as const] : [])));
  return pod.rounds.flatMap((round, i) =>
    writeRound(round, {
      swissType,
      finalized,
      finalCut: isFinalCutRound(pod, round),
      last: i === pod.rounds.length - 1,
      lastSwiss: round.kind === 'swiss' && round.number === lastSwiss,
      now,
      preserveClock,
      fixed,
      fullTime: fullRoundSeconds(t, round.kind),
      codes: t.passthrough?.roundCodes[`${pod.category}:${round.number}`]
    })
  );
}

function writePod(t: Tournament, pod: Pod, save: PodSave): string[] {
  const extra = t.passthrough?.podExtras[pod.category];
  const hasCut = pod.rounds.some(r => r.kind === 'elimination');
  const rounds = writePodRounds(t, pod, save);
  const roster = pod.playerIds.map(id => `<player userid="${esc(id)}" />`);
  return [
    `<pod category="${CATEGORY_CODES[pod.category]}" stage="${hasCut ? '1' : (extra?.stage ?? '0')}">`,
    ...block(1, [
      '<poddata>',
      ...block(1, [
        tag('startingtable', pod.startingTable),
        tag('playoff3rd4th', String(pod.playoff3rd4th)),
        ...(extra?.extra.map(([, xml]) => xml) ?? NEW_POD_EXTRAS)
      ]),
      '</poddata>',
      '<subgroups>',
      ...block(
        1,
        hasStarted(t)
          ? ['<subgroup number="1">', ...block(1, ['<players>', ...block(1, roster), '</players>']), '</subgroup>']
          : []
      ),
      '</subgroups>',
      '<rounds>',
      ...block(1, rounds),
      '</rounds>'
    ]),
    '</pod>'
  ];
}

/** Division of each player as the event placed them: their pod's, or for a combined pod, `divisionOf`. */
function divisionPlayers(t: Tournament, divisionOf: (id: string) => Division): Map<Division, Pod[]> {
  const pods = new Map<Division, Pod[]>();
  // A division's top cut is played by players its Swiss pod already counts.
  for (const pod of t.pods.filter(p => !p.cutOf)) {
    for (const division of DIVISIONS) {
      const ids = pod.playerIds.filter(id =>
        isDivision(pod.category) ? pod.category === division : divisionOf(id) === division
      );
      if (ids.length > 0) {
        pods.set(division, [...(pods.get(division) ?? []), { ...pod, playerIds: ids }]);
      }
    }
  }
  return pods;
}

function compareNames(a: Player, b: Player): number {
  const [first, second] = [a, b].map(p => `${p.firstName}\0${p.lastName}`.toLowerCase());
  return first! < second! ? -1 : Number(first! > second!);
}

function rootValue(t: Tournament, key: string): string | undefined {
  return t.passthrough?.rootAttrs.find(([name]) => name === key)?.[1];
}

function writeStandings(t: Tournament, divisionOf: (id: string) => Division): string[] {
  const byDivision = divisionPlayers(t, divisionOf);
  const categories: (Division | 'mixed')[] =
    rootValue(t, 'type') === '1' || rootValue(t, 'gametype') === 'GO' ? ['mixed'] : [...DIVISIONS].reverse();
  const pods = categories.flatMap(division => {
    const fields = division === 'mixed' ? t.pods : (byDivision.get(division) ?? []);
    const places = fields.flatMap(pod => {
      const full = t.pods.find(p => p.category === pod.category) ?? pod;
      const only = new Set(pod.playerIds);
      const swiss = swissStandings(full, t.players, { only, regularRounds: regularRounds(t, full) });
      return placeFinals(division === 'mixed' ? full : (cutPodOf(t, full, division) ?? full), swiss);
    });
    const only = new Set(fields.flatMap(p => p.playerIds));
    const dnf = t.players.filter(p => only.has(p.id) && p.disqualified).sort(compareNames);
    const code = CATEGORY_CODES[division];
    const rows = places.map(row => `<player id="${esc(row.playerId)}" place="${row.place}" />`);
    return [
      `<pod category="${code}" type="finished">`,
      ...block(1, rows),
      '</pod>',
      `<pod category="${code}" type="dnf">`,
      ...block(
        1,
        dnf.map(p => `<player id="${p.id}" />`)
      ),
      '</pod>'
    ];
  });
  return ['<standings>', ...block(1, pods), '</standings>'];
}

function finalStandings(t: Tournament, divisionOf: (id: string) => Division): string[] {
  const saved = t.passthrough?.standings;
  return saved?.state === standingsState(t) ? saved.xml.split('\n') : writeStandings(t, divisionOf);
}

function finalsCount(t: Tournament, pod: Pod, division: Division, of: (id: string) => Division): number {
  const frozen = pod.divisionCounts?.[division];
  if (frozen !== undefined) {
    return frozen;
  }
  return attendees(pod).filter(id => (isDivision(pod.category) ? pod.category === division : of(id) === division))
    .length;
}

function plannedSwiss(t: Tournament, pod: Pod): number {
  const of = divisionLookup(t);
  const count = Math.max(...divisionsOf(pod.category).map(d => finalsCount(t, pod, d, of)));
  return recommendedStructure(count, eventTypeOf(t)).rounds;
}

function pairedThirdPlace(cut: Pod | undefined): boolean {
  if (!cut?.playoff3rd4th) {
    return false;
  }
  return (
    cut.rounds.at(-1)?.matches.length === 2 &&
    cut.rounds.filter(r => r.kind === 'elimination').length >= Math.log2(cut.cut)
  );
}

function chosenCut(t: Tournament, pod: Pod | undefined, cut: Pod | undefined, division: Division): number {
  return eventTypeOf(t) === 'challenge' ? 0 : (pod?.divisionCuts?.[division]?.size ?? cut?.cut ?? 0);
}

function categoryCut(t: Tournament, division: Division, pods: Pod[], of: (id: string) => Division): string[] {
  const combined = t.pods.some(p => !isDivision(p.category) && !p.cutOf);
  if (!pods.length && !combined) {
    return [];
  }
  const pod = t.pods.find(p => p.category === pods[0]?.category);
  const cut = pod && (cutPodOf(t, pod, division) ?? pod);
  const count = pod ? finalsCount(t, pod, division, of) : 0;
  const values = [0, ...(count >= 9 ? [4] : []), ...(count > 20 ? [8] : [])];
  return [
    `<categorycut key="${CATEGORY_CODES[division]}">`,
    ...block(1, [
      '<options>',
      ...block(
        1,
        values.map(value => tag('value', value))
      ),
      '</options>',
      tag('cut', chosenCut(t, pod, cut, division)),
      tag('playercount', count),
      tag('paired3rd4th', String(pairedThirdPlace(cut)))
    ]),
    '</categorycut>'
  ];
}

function writeFinalsOptions(t: Tournament, divisionOf: (id: string) => Division): string[] {
  if (t.passthrough?.finalsOptions && (!t.passthrough.finalsState || t.passthrough.finalsState === finalsState(t))) {
    return t.passthrough.finalsOptions.split('\n');
  }
  const byDivision = divisionPlayers(t, divisionOf);
  const cuts = [...DIVISIONS].reverse().flatMap(d => categoryCut(t, d, byDivision.get(d) ?? [], divisionOf));
  return ['<finalsoptions>', ...block(1, cuts), '</finalsoptions>'];
}

/** The root's stage: finalized, as TOM left it, or for a new file, whether play has started. */
function rootStage(t: Tournament, finalized: boolean): string {
  if (finalized) {
    return FINALIZED;
  }
  const kept = rootValue(t, 'stage');
  if (kept && kept !== FINALIZED && (!hasStarted(t) || Number(kept) >= 4)) {
    return kept;
  }
  return hasStarted(t) ? '4' : t.pods.length ? '3' : '1';
}

function rootAttrs(t: Tournament, finalized: boolean): string {
  const stage = rootStage(t, finalized);
  return (t.passthrough?.rootAttrs ?? defaultRootAttrs(eventTypeOf(t), t.pods.length > 0))
    .map(([key, value]) => ` ${key}="${esc(key === 'stage' ? stage : value)}"`)
    .join('');
}

export interface WriteOptions {
  /** Marks the event finished and writes final standings, as TOM's "Finalize Results" does. */
  finalized?: boolean;
  /** Save time in epoch milliseconds; defaults to the current time. */
  now?: number;
  /** Each player's age division, for standings in a combined pod. Defaults to birth year and event season. */
  divisionOf?: (id: string) => Division;
}

/** Writes the tournament as a .tdf, in TOM's own layout. */
function unchangedSource(t: Tournament, finalized: boolean): string | undefined {
  const original = t.passthrough?.original;
  return original?.state === comparable(t) && finalized === wasFinalized(t) ? original.xml : undefined;
}

function writeRoster(t: Tournament): string[] {
  const original = t.passthrough?.original;
  const oldPlayers = original ? (JSON.parse(original.state) as Tournament).players : [];
  const originals = new Map(oldPlayers.map(p => [p.id, p]));
  return t.players.flatMap(p =>
    writePlayer(
      p,
      t.passthrough?.playerExtras[p.id] ?? [],
      hasStarted(t),
      comparable(originals.get(p.id)) === comparable(p)
    )
  );
}

export function writeTdf(input: Tournament, options: WriteOptions = {}): string {
  const t = normalizeCutPods(input);
  const finalized = options.finalized ?? wasFinalized(t);
  if (finalized && t.pods.some(pod => pod.rounds.some(round => round.matches.some(m => m.outcome === 'pending')))) {
    throw new Error('Enter all match results to finalize');
  }
  const source = unchangedSource(t, finalized);
  if (source && options.now === undefined) {
    return source;
  }
  const divisionOf = options.divisionOf ?? divisionLookup(t);
  const players = writeRoster(t);
  const pods = t.pods.flatMap(pod =>
    writePod(t, pod, {
      finalized,
      now: options.now ?? Date.now(),
      preserveClock: options.now === undefined && t.passthrough !== undefined
    })
  );
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<tournament${rootAttrs(t, finalized)}>`,
    ...block(1, [
      ...writeData(t),
      tag('timeelapsed', t.passthrough?.timeElapsed ?? '0'),
      '<players>',
      ...block(1, players),
      '</players>',
      '<pods>',
      ...block(1, pods),
      '</pods>',
      ...(finalized ? finalStandings(t, divisionOf) : []),
      ...writeFinalsOptions(t, divisionOf)
    ]),
    '</tournament>'
  ];
  return `${lines.join('\n')}\n`;
}

/** Whether TOM had finalized the file this came from. */
export function wasFinalized(t: Tournament): boolean {
  return t.passthrough?.rootAttrs.some(([key, value]) => key === 'stage' && value === FINALIZED) ?? false;
}
