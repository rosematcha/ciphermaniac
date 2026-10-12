import type { CommandContext, NewPlayer } from './legacyCommands.js';
import type { Match, Pod, PodCategory, Tournament, TournamentInfo, TournamentSettings } from './types.js';

export type LifecycleOperation =
  | { type: 'create'; info: TournamentInfo; settings: Pick<TournamentSettings, 'type' | 'mode'> }
  | { type: 'register'; players: (NewPlayer & { byes?: number; fixedTable?: number })[] }
  | {
      type: 'configure';
      eventType: 1 | 2 | 3;
      cut: number;
      divisionCuts?: Partial<Record<PodCategory, number>>;
      flights: number;
      lessSwiss: boolean;
      additionalRounds: number;
      thirdPlace: boolean;
      manualTables: boolean;
      blockedRanges: { start: number; end: number }[];
      roundMinutes: number;
      finalMinutes: number;
      overflowTableStart?: number;
      /** Settings entered through TOM's creation wizard and its Verify step rather than written directly. */
      wizard?: boolean;
    }
  | { type: 'setFlights'; pod?: PodCategory; count: number }
  | { type: 'start' }
  | { type: 'pair'; pod?: PodCategory; repair?: boolean; terminal?: boolean }
  | {
      type: 'viewPairings';
      pod?: PodCategory;
      /** V18-5: apply TOM's stage step from any stage, as scenarios do. */ step?: boolean;
    }
  | { type: 'startRound' | 'viewRecords' | 'viewStandings' | 'playAnotherRound'; pod?: PodCategory }
  | { type: 'reopen'; pod?: PodCategory; round?: number; table?: number; player?: string }
  | { type: 'sampleClock'; pod?: PodCategory; seconds: number }
  | { type: 'results'; pod?: PodCategory; results: Match[]; entryMode?: 'main' | 'slip' }
  | { type: 'drop'; id: string; disqualified: boolean; timestamp: string }
  | { type: 'reenter'; id: string }
  | { type: 'late'; player: NewPlayer; markLate: boolean; forcedLoss: boolean; timestamp: string }
  | { type: 'topCut'; pod?: PodCategory }
  | { type: 'reload'; pod?: PodCategory; seconds?: number }
  | { type: 'finish' };

/** Only nondeterministic choices can be supplied. Tables, stages and outcomes remain engine decisions. */
export interface RecordedChoices {
  /** A terminal pairing abort whose subsequent TOM save is incomplete. */
  repairError?: boolean;
  /** V18-10: the opening draw's recorded seat order can survive a subsequent playoff abort. */
  abortedBracketOrder?: readonly string[];
  /** V19-5: a successful Swiss repair can save the abandoned search's partial matches. */
  partialRepair?: Partial<Record<PodCategory, readonly Match[]>>;
  /** V17-6: the saved partial matches of a randomly aborted repair. */
  abortedRepair?: Partial<Record<PodCategory, readonly Match[]>>;
  /** V20-1: a departure before start can keep the player's match after an unreopened search restart. */
  keptDepartureMatch?: boolean;
  /** V22-5: a restarted search can leave these holders' random byes, paired since the last reading, unrecorded. */
  freshRandomByes?: readonly string[];
  /** V17-8: bounded Swiss search can exhaust itself despite an available pairing. */
  noRound?: boolean;
  /** V18-3: a repair's pool pairing, not its first step, took apart the matches of a round left without survivors. */
  takenApart?: boolean;
  eliminationTieOrder?: Tournament['eliminationTieOrder'];
  headToHeadOrder?: Tournament['headToHeadOrder'];
  thirdPlaceOrder?: Tournament['thirdPlaceOrder'];
  /** PAIRING V24-7: a return's saved round: its match count and its last match. */
  returnMatch?: { matches: number; match: Match };
  /** SPEC V24-9: the cut start's seeded players in seed order, the choice for a head-to-head cycle. */
  cutSeeds?: readonly string[];
  /** Tables held by the random pairing search after its initial repair dissolution. */
  heldRepairTables?: readonly number[];
  /** V17-5: search-held tables are released after that flight is numbered. */
  heldRepairTablesByFlight?: Partial<Record<PodCategory, Readonly<Record<number, readonly number[]>>>>;
  retainedTables?: readonly number[];
  retainedPairings?: readonly { p1: string; p2: string | null }[];
  rosterOrder?: readonly string[];
  flights?: Partial<Record<PodCategory, NonNullable<Pod['flights']>>>;
  pairings?: Partial<Record<PodCategory, readonly { p1: string; p2: string | null }[]>>;
  /** Each standings category's ordered disqualified list; it orders only identically named players. */
  disqualifiedNameOrder?: readonly (readonly string[])[];
}

export interface LifecycleContext extends CommandContext {
  /** A direct bounded pairing attempt omits ordinary renumbering and pairing marks. */
  terminalPairing?: boolean;
  recorded?: RecordedChoices;
}
export interface LifecycleResult {
  ok: boolean;
  tournament: Tournament;
  error?: string;
  saveFailed?: boolean;
  /** V18-2: a later attempt paired and saved the round, although TOM reports that no round was paired. */
  retried?: boolean;
}
