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
 *   (2 for a League Challenge, 3 for a Cup). Stage 2 is paired or playing,
 *   6 finished (5 in older files), and 8 the last round of a finalized event.
 * - Pod categories: 0 Juniors, 1 Seniors, 2 Masters, 8 Juniors and Seniors,
 *   9 Seniors and Masters, 10 everyone.
 * - `<standings>` is written only once the event is finalized (root stage 5).
 *
 * Anything else TOM put in the file rides along in `passthrough` as XML, so
 * writing an imported file changes only what the site changed.
 */

import { divisionLookup } from './divisions.js';
import { placeFinals, swissStandings } from './standings.js';
import {
  type Division,
  DIVISIONS,
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
  bye: '5',
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

/** What a new file says about itself: TOM 1.86, a one-day TCG event. */
export const DEFAULT_ROOT_ATTRS: [string, string][] = [
  ['type', '3'],
  ['stage', '1'],
  ['version', '1.86'],
  ['gametype', 'TRADING_CARD_GAME'],
  ['mode', 'TCG1DAY']
];

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

function readInfo(data: XmlElement | undefined): TournamentInfo {
  const organizer = child(data, 'organizer');
  return {
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
  const droppedRound = dropped && childText(dropped, 'status') !== '0' ? int(childText(dropped, 'round')) : null;
  return {
    id: attr(element, 'userid'),
    firstName: childText(element, 'firstname'),
    lastName: childText(element, 'lastname'),
    birthDate: childText(element, 'birthdate'),
    droppedAfter: droppedRound,
    ...(childText(element, 'starter') === 'false' || childText(element, 'late') === 'true' ? { late: true } : {}),
    created: childText(element, 'creationdate'),
    modified: childText(element, 'lastmodifieddate')
  };
}

function readMatch(element: XmlElement): Match {
  const single = child(element, 'player');
  return {
    table: int(childText(element, 'tablenumber')),
    p1: attr(single ?? child(element, 'player1'), 'userid'),
    p2: single ? null : attr(child(element, 'player2'), 'userid') || null,
    outcome: known(OUTCOMES_BY_CODE, attr(element, 'outcome'), 'match outcome'),
    timestamp: childText(element, 'timestamp')
  };
}

function roundStatus(stage: string, matches: readonly Match[], startTime: string): RoundStatus {
  if (FINISHED_STAGES.has(stage) || (matches.length > 0 && matches.every(m => m.outcome !== 'pending'))) {
    return 'finished';
  }
  return startTime || matches.some(m => m.outcome !== 'pending') ? 'started' : 'paired';
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
        { type: attr(round, 'type'), stage: attr(round, 'stage') }
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
  return pods.map(pod => ({ ...pod, cut: cuts.get(CATEGORY_CODES[pod.category]) ?? 0 }));
}

/** Reads a .tdf. Throws when the file is not XML or not a TOM tournament. */
export function parseTdf(source: string): Tournament {
  const root = parseXml(source);
  if (root.name !== 'tournament') {
    throw new Error('Not a TOM tournament file');
  }
  const data = child(root, 'data');
  const playerElements = children(child(root, 'players'), 'player');
  const podElements = children(child(root, 'pods'), 'pod');
  const finals = child(root, 'finalsoptions');
  const tournament: Tournament = {
    info: readInfo(data),
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
  const standings = child(root, 'standings');
  if (standings && tournament.passthrough) {
    tournament.passthrough.standings = { xml: serializeElement(standings), state: standingsState(tournament) };
  }
  return tournament;
}

/** Only changes that can affect final places invalidate TOM's saved standings. */
function standingsState(t: Tournament): string {
  return JSON.stringify(
    [t.info.startDate, t.players, t.pods],
    [
      'id',
      'birthDate',
      'droppedAfter',
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
  if (drop && childText(drop, 'status') !== '0' && childText(drop, 'round') === String(player.droppedAfter)) {
    return [saved];
  }
  return [
    '<dropped>',
    ...block(1, [tag('status', 1), tag('round', player.droppedAfter), tag('timestamp', player.modified)]),
    '</dropped>'
  ];
}

function playerFields(player: Player, extra: [string, string][]): string[] {
  const values: Record<string, string> = {
    starter: String(!player.late),
    late: String(player.late === true),
    creationdate: player.created,
    lastmodifieddate: player.modified
  };
  const fields = [...extra];
  for (const name of ['creationdate', 'lastmodifieddate', 'dropped']) {
    if (!extra.some(([key]) => key === name)) {
      fields.push([name, '']);
    }
  }
  return fields.flatMap(([name, xml]) => {
    if (name === 'dropped') {
      return writeDrop(player, extra);
    }
    return [Object.hasOwn(values, name) ? tag(name, values[name] ?? '') : xml];
  });
}

function writePlayer(player: Player, extra: [string, string][]): string[] {
  return [
    `<player userid="${esc(player.id)}">`,
    ...block(1, [
      tag('firstname', player.firstName),
      tag('lastname', player.lastName),
      tag('birthdate', player.birthDate),
      ...playerFields(player, extra)
    ]),
    '</player>'
  ];
}

function writeMatch(match: Match): string[] {
  const seats =
    match.p2 === null
      ? [`<player userid="${esc(match.p1)}"/>`]
      : [`<player1 userid="${esc(match.p1)}"/>`, `<player2 userid="${esc(match.p2)}"/>`];
  return [
    `<match outcome="${OUTCOME_CODES[match.outcome]}">`,
    ...block(1, [...seats, tag('timestamp', match.timestamp), tag('tablenumber', match.table)]),
    '</match>'
  ];
}

interface RoundContext {
  swissType: string;
  finalized: boolean;
  last: boolean;
  codes: { type: string; stage: string } | undefined;
}

function roundStage(round: Round, context: RoundContext): string {
  const kept = context.codes?.stage;
  const complete =
    round.status === 'finished' || (round.matches.length > 0 && round.matches.every(m => m.outcome !== 'pending'));
  if (!complete) {
    return kept && !FINISHED_STAGES.has(kept) ? kept : STAGE_PLAYING;
  }
  if (context.finalized && context.last) {
    return STAGE_FINAL;
  }
  // A finished round keeps TOM's own finished code; one the site finished gets the usual one.
  return kept && FINISHED_STAGES.has(kept) ? kept : STAGE_FINISHED;
}

function writeRound(round: Round, context: RoundContext): string[] {
  const type = round.kind === 'elimination' ? ELIMINATION_TYPE : (context.codes?.type ?? context.swissType);
  const matches = round.matches.flatMap(writeMatch);
  return [
    `<round number="${round.number}" type="${type}" stage="${roundStage(round, context)}" >`,
    ...block(1, [
      tag('timeleft', round.timeLeft),
      tag('pairtime', round.pairTime),
      tag('starttime', round.startTime),
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

function writePod(t: Tournament, pod: Pod, finalized: boolean): string[] {
  const extra = t.passthrough?.podExtras[pod.category];
  const swissType = t.passthrough?.rootAttrs.find(([key]) => key === 'type')?.[1] ?? '3';
  const rounds = pod.rounds.flatMap((round, i) =>
    writeRound(round, {
      swissType,
      finalized,
      last: i === pod.rounds.length - 1,
      codes: t.passthrough?.roundCodes[`${pod.category}:${round.number}`]
    })
  );
  const roster = pod.playerIds.map(id => `<player userid="${esc(id)}" />`);
  return [
    `<pod category="${CATEGORY_CODES[pod.category]}" stage="${extra?.stage ?? '0'}">`,
    ...block(1, [
      '<poddata>',
      ...block(1, [
        tag('startingtable', pod.startingTable),
        tag('playoff3rd4th', String(pod.playoff3rd4th)),
        ...(extra?.extra.map(([, xml]) => xml) ?? NEW_POD_EXTRAS)
      ]),
      '</poddata>',
      '<subgroups>',
      ...block(1, [
        '<subgroup number="1">',
        ...block(1, ['<players>', ...block(1, roster), '</players>']),
        '</subgroup>'
      ]),
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
  for (const pod of t.pods) {
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

function isDivision(category: PodCategory): category is Division {
  return (DIVISIONS as readonly string[]).includes(category);
}

function writeStandings(t: Tournament, divisionOf: (id: string) => Division): string[] {
  const byDivision = divisionPlayers(t, divisionOf);
  const pods = ([...DIVISIONS].reverse() as Division[]).flatMap(division => {
    const places = (byDivision.get(division) ?? []).flatMap(pod => {
      const full = t.pods.find(p => p.category === pod.category) ?? pod;
      const only = new Set(pod.playerIds);
      return placeFinals(full, swissStandings(full, t.players, { only }));
    });
    const code = CATEGORY_CODES[division];
    const rows = places.map(row => `<player id="${esc(row.playerId)}" place="${row.place}" />`);
    return [
      `<pod category="${code}" type="finished">`,
      ...block(1, rows),
      '</pod>',
      `<pod category="${code}" type="dnf">`,
      '</pod>'
    ];
  });
  return ['<standings>', ...block(1, pods), '</standings>'];
}

function finalStandings(t: Tournament, divisionOf: (id: string) => Division): string[] {
  const saved = t.passthrough?.standings;
  return saved?.state === standingsState(t) ? saved.xml.split('\n') : writeStandings(t, divisionOf);
}

function writeFinalsOptions(t: Tournament, divisionOf: (id: string) => Division): string[] {
  if (t.passthrough?.finalsOptions) {
    return t.passthrough.finalsOptions.split('\n');
  }
  const cuts = [...divisionPlayers(t, divisionOf)].flatMap(([division, pods]) => [
    `<categorycut key="${CATEGORY_CODES[division]}">`,
    ...block(1, [
      '<options>',
      ...block(1, [tag('value', 0), ...(pods[0]?.cut ? [tag('value', pods[0].cut)] : [])]),
      '</options>',
      tag('cut', pods[0]?.cut ?? 0),
      tag(
        'playercount',
        pods.reduce((sum, pod) => sum + pod.playerIds.length, 0)
      ),
      tag('paired3rd4th', String(pods[0]?.playoff3rd4th ?? false))
    ]),
    '</categorycut>'
  ]);
  return cuts.length
    ? ['<finalsoptions>', ...block(1, cuts), '</finalsoptions>']
    : ['<finalsoptions>', '</finalsoptions>'];
}

/** The root's stage: finalized, as TOM left it, or for a new file, whether play has started. */
function rootStage(t: Tournament, finalized: boolean): string {
  if (finalized) {
    return FINALIZED;
  }
  const kept = t.passthrough?.rootAttrs.find(([key]) => key === 'stage')?.[1];
  if (kept && kept !== FINALIZED) {
    return kept;
  }
  return t.pods.some(pod => pod.rounds.length > 0) ? '4' : '1';
}

function rootAttrs(t: Tournament, finalized: boolean): string {
  const stage = rootStage(t, finalized);
  return (t.passthrough?.rootAttrs ?? DEFAULT_ROOT_ATTRS)
    .map(([key, value]) => ` ${key}="${esc(key === 'stage' ? stage : value)}"`)
    .join('');
}

export interface WriteOptions {
  /** Marks the event finished and writes final standings, as TOM's "Finalize Results" does. */
  finalized?: boolean;
  /** Each player's age division, for standings in a combined pod. Defaults to birth year and event season. */
  divisionOf?: (id: string) => Division;
}

/** Writes the tournament as a .tdf, in TOM's own layout. */
export function writeTdf(t: Tournament, options: WriteOptions = {}): string {
  const finalized = options.finalized ?? wasFinalized(t);
  if (finalized && t.pods.some(pod => pod.rounds.some(round => round.matches.some(m => m.outcome === 'pending')))) {
    throw new Error('Enter all match results to finalize');
  }
  const divisionOf = options.divisionOf ?? divisionLookup(t);
  const extras = t.passthrough?.playerExtras ?? {};
  const players = t.players.flatMap(p => writePlayer(p, extras[p.id] ?? [['starter', '']]));
  const pods = t.pods.flatMap(pod => writePod(t, pod, finalized));
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
