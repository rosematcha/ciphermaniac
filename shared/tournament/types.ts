/**
 * One tournament, as both TOM's .tdf and the Swiss runner see it.
 *
 * The shape follows the .tdf closely so a file read in can be written back out
 * without losing anything TOM put there: players, pods (one per age division,
 * or one for divisions played together), rounds and matches. What TOM stores as numeric
 * codes is named here, and `shared/tournament/tdf.ts` is the only place that
 * knows the numbers.
 */

export type Division = 'junior' | 'senior' | 'masters';

export const DIVISIONS: readonly Division[] = ['junior', 'senior', 'masters'];

/** Whether a value, a pod's category among them, names one age division rather than several played together. */
export function isDivision(value: unknown): value is Division {
  return (DIVISIONS as readonly unknown[]).includes(value);
}

export const DIVISION_LABELS: Record<Division, string> = {
  junior: 'Juniors',
  senior: 'Seniors',
  masters: 'Masters'
};

/**
 * Who a pod pairs: one division, or two or three played together. Play!
 * Pokémon combines a division with fewer than six players into the next; the
 * players still get their own division's standings and top cut.
 */
export type PodCategory = Division | 'junior-senior' | 'senior-masters' | 'mixed';

export const POD_CATEGORIES: readonly PodCategory[] = [
  'junior',
  'senior',
  'masters',
  'junior-senior',
  'senior-masters',
  'mixed'
];

export const POD_LABELS: Record<PodCategory, string> = {
  ...DIVISION_LABELS,
  'junior-senior': 'Juniors and Seniors',
  'senior-masters': 'Seniors and Masters',
  mixed: 'All divisions'
};

/**
 * A match's result. `p1`/`p2` name the winner; `bye` is player one's free win
 * with no opponent; `loss` is player one's loss with no opponent, which is how
 * a round a late entrant missed is recorded.
 */
export type Outcome = 'pending' | 'p1' | 'p2' | 'tie' | 'double-loss' | 'bye' | 'assigned-bye' | 'deleted' | 'loss';

export const REPORTABLE_OUTCOMES: readonly Outcome[] = ['p1', 'p2', 'tie', 'double-loss'];

export interface Player {
  /** The POP ID TOM keys players by; a Swiss event without one gets a generated ID. */
  id: string;
  firstName: string;
  lastName: string;
  /** MM/DD/YYYY as TOM writes it, or '' when unknown. */
  birthDate: string;
  /** Set after the round the player dropped in; null while they are still playing. */
  droppedAfter: number | null;
  /**
   * Dropped by disqualification: out of the standings altogether, though
   * their matches still count for their opponents. Written as drop status 2.
   */
  disqualified?: true;
  /**
   * Tagged late in TOM (its "Is late?" box); ranks below other players on the
   * same points. Late additions carry TOM's structured late-entry metadata.
   */
  late?: boolean;
  /** TOM's starter flag; absent in older site documents, inferred from round 1. */
  starter?: boolean;
  lateData?: { round: number; timestamp: string; forcedLoss: boolean; usedForcedLoss: boolean };
  order?: number;
  seed?: number;
  /** TOM's original award of assigned byes; it never counts down. */
  byes?: number;
  /** Awarded assigned byes whose match was removed before its round started; TOM does not refund them. */
  forfeitedByes?: number;
  /** Schedule assigned at tournament start or file reopening; zero for uninterrupted late entrants. */
  scheduledSwissRounds?: number;
  /**
   * The table this player sits at every round, for a player who cannot move
   * between tables. Their match takes that table; everyone else fills the rest.
   */
  fixedTable?: number;
  /** Added to the event by submitting a decklist rather than by staff. */
  fromList?: boolean;
  /** TOM's timestamps, kept so a round trip leaves them as they were. */
  created: string;
  modified: string;
  /** TOM assigns zero to late additions until the document is reopened. */
  tiebreaker?: number;
  /**
   * Recorded relative order among disqualified players whose names compare equal, during
   * uninterrupted play only; reopening the file drops it and saved roster order decides.
   */
  disqualifiedOrder?: number;
  droppedAt?: string;
}

export interface Match {
  table: number;
  p1: string;
  /** Null for a bye or a missed-round loss. */
  p2: string | null;
  outcome: Outcome;
  /** When the result was entered, as TOM writes it. */
  timestamp: string;
}

export type RoundKind = 'swiss' | 'elimination';

/** Paired and waiting, clock running, or every result in. */
export type RoundStatus = 'paired' | 'started' | 'finished';

export interface Round {
  number: number;
  /** Explicit workflow stage for engine-created TOM rounds. */
  stage?: number;
  kind: RoundKind;
  status: RoundStatus;
  /** Seconds on the clock when it was last stopped or saved. */
  timeLeft: number;
  /** MM/DD/YYYY HH:mm:ss, venue time. */
  pairTime: string;
  startTime: string;
  /** First round start in epoch milliseconds, independent of the venue's time zone. */
  startedAt?: number;
  /**
   * When the clock last started, in epoch ms; null while it is stopped. The
   * site's own clock, since TOM's times are venue-local with no zone.
   */
  clockStartedAt?: number | null;
  matches: Match[];
}

export interface Pod {
  category: PodCategory;
  /** Player IDs in the pod, in TOM's order: every division it plays (see podding.ts). */
  playerIds: string[];
  /** Ordered, persistent Swiss flight membership. */
  flights?: { number: number; playerIds: string[] }[];
  rounds: Round[];
  /** Top cut size once one is set; 0 for none. */
  cut: number;
  /** Whether the cut plays for third place. */
  playoff3rd4th: boolean;
  startingTable: number;
  stage?: 0 | 1 | 2;
  subgroupCount?: number;
  additionalRounds?: number;
  blockedRanges?: { start: number; end: number }[];
  /**
   * Legacy storage and read-only division views: the original combined pod.
   * Stored cuts now live in divisionCuts and share this pod's round list.
   */
  cutOf?: PodCategory;
  /** Per-division brackets in this pod's shared elimination rounds. */
  divisionCuts?: Partial<Record<Division, { size: number; playoff3rd4th: boolean; playerIds?: string[] }>>;
  /** PAIRING V18-8: TOM's surviving players of a top cut or an elimination-only pod; absent before either begins. */
  survivors?: string[];
  /** V19-3: a repaired opening round whose matches are not its players' history until reload. */
  historyOmittedRound?: number;
  /** V25-2: latest two-player opponents dissolved by repairs since the last reading. */
  dissolvedOpponents?: { playerId: string; opponentId: string; round: number }[];
  /** V24-2: a reading's rebuilt cut list, held until TOM first checks whether the cut is finished. */
  survivorsUnconfirmed?: true;
  /** V19-5: an abandoned repair's unsaved seats hide waiting players until reload. */
  repairOmittedPlayers?: string[];
  /** The divisions whose top-cut playoff TOM records as paired (`paired3rd4th`); it stays set through repairs. */
  playoffsPaired?: Division[];
  /** PAIRING V18-2: assigned byes of failed pairing attempts, unsaved yet counted until the file is reopened. */
  unsavedByes?: { round: number; playerId: string }[];
  /** PAIRING V18-2: players whose only record of a failed attempt's match is in memory; it is match history. */
  unsavedPlayers?: string[];
  /** PAIRING V22-4: random byes failed attempts left in their holders' records until the file is reopened. */
  unsavedRandomByes?: string[];
  /** PAIRING V22-1: players a departure before the start left without a record until reopening or a new match. */
  lostRecords?: string[];
  /** Roster frozen at start, including entrants with assigned byes. */
  startingPlayerIds?: string[];
  divisionCounts?: Partial<Record<Division, number>>;
}

/**
 * The kind of local event, which sets its structure: a League Challenge plays
 * Swiss rounds only, a League Cup Swiss rounds then a top cut, each on its own
 * attendance table (Tournament Rules Handbook §5.5.6). TOM writes a Challenge
 * with root and Swiss round type 2, a Cup with 3.
 */
export type EventType = 'challenge' | 'cup';

export const EVENT_TYPES: readonly EventType[] = ['cup', 'challenge'];

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  cup: 'League Cup',
  challenge: 'League Challenge'
};

export interface TournamentInfo {
  name: string;
  /** Play! Pokémon sanction ID, e.g. 12-34-567890, or '' for an unsanctioned event. */
  sanctionId: string;
  city: string;
  state: string;
  country: string;
  /** Minutes. */
  roundTime: number;
  finalsRoundTime: number;
  organizerPopId: string;
  organizerName: string;
  /** MM/DD/YYYY. */
  startDate: string;
  /** Absent on events from before the choice existed, which play as League Cups (see eventTypeOf). */
  eventType?: EventType;
}

export interface TournamentSettings {
  type: 1 | 2 | 3;
  mode: 'CUSTOM' | 'PRERELEASE' | 'LEAGUECHALLENGE' | 'TCG1DAY';
  stage: 1 | 3 | 4 | 5;
  lessSwiss: boolean;
  autoTables: boolean;
  overflowTableStart: number;
  elapsedSeconds: number;
}

export interface Tournament {
  /** Recorded equal-win elimination groups with indeterminate third-place comparisons. */
  eliminationTieOrder?: { category: PodCategory; playerIds: string[] }[];
  /** V24-5 / V25-2: a save's recorded order for indeterminate third-place or repaired-opponent groups. */
  thirdPlaceOrder?: { category: PodCategory; playerIds: string[] }[];
  /** Recorded relative order for cyclic head-to-head groups in final standings. */
  headToHeadOrder?: { category: PodCategory; playerIds: string[] }[];
  settings?: TournamentSettings;
  info: TournamentInfo;
  players: Player[];
  pods: Pod[];
  /**
   * What a read .tdf carried that this model does not use, kept verbatim so
   * writing the file back loses none of it. Absent on a Swiss event until its
   * first export.
   */
  passthrough?: TdfPassthrough;
  /** Fixed when the first pod starts; the players array is then the final tiebreak order. */
  startedAt?: number;
}

export interface TdfPassthrough {
  rootAttrs: [string, string][];
  /** `<data>` children other than the ones `TournamentInfo` names, as [tag, text]. */
  extraData: [string, string][];
  timeElapsed: string;
  /** Per player ID: `<starter>` and any unknown child elements. */
  playerExtras: Record<string, [string, string][]>;
  /** Per pod category: the pod's `stage` and poddata beyond the known fields. */
  podExtras: Partial<Record<PodCategory, { stage: string; extra: [string, string][] }>>;
  /** Per round, keyed `category:number`: TOM's own type and stage codes. */
  roundCodes: Record<string, { type: string; stage: string; timeLeft?: number; startTime?: string; state?: string }>;
  finalsOptions: string;
  finalsState?: string;
  /** TOM's finalized places and the inputs they describe; retained until results or entrants change. */
  standings?: { xml: string; state: string };
}

export function playerName(player: Pick<Player, 'firstName' | 'lastName'>): string {
  return `${player.firstName} ${player.lastName}`.trim();
}
