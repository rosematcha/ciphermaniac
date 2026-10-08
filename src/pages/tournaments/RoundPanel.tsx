/**
 * The console's round view: the round's tables with result entry, in one
 * box: a bar for the round (picker, progress, swap, re-pair, delete, clock),
 * a bar to narrow the room, then the tables. Pairing the next round is the
 * console head's step (ManageEvent); what Slowpoke could not do lives here:
 * when a player is added after pairing, a note says who is not seated and
 * re-pairs the round around the results already in.
 *
 * Results are entered by pressing the winner's name, then Record in the row,
 * so a slip of the finger is not a result; a double click on the name records
 * it at once, for a result read off a slip. The filter narrows the room to
 * one table (type its number) or player, or to the tables still playing, so
 * a result called out across the room is a few keystrokes and two presses,
 * and focus comes back to the filter for the next one. Where players report
 * their own, each open match says what they reported, and staff accept a
 * lone report or settle a dispute by entering the result as usual. With
 * archetypes on, Enter decks turns every seat into its player's deck picker,
 * for naming decks as the room is walked.
 */

import { createEffect, createMemo, createSignal, For, type JSX, lazy, on, onCleanup, Show, Suspense } from 'solid-js';
import { isDisputed, type PlayerReport, reportsFor } from '../../../shared/tournament/reports';
import { latestRound, withSwiss } from '../../../shared/tournament/rounds';
import { DIVISION_LABELS, type Match, type Outcome, type Pod, type Round } from '../../../shared/tournament/types';
import { decksEnabled } from '../../../shared/tournament/view';
import { Segmented } from '../../components/Segmented';
import type { Manage } from '../../lib/tournament/api';
import {
  champions,
  filterMatches,
  hasCut,
  MATCH_VIEWS,
  type MatchView,
  namesById,
  outcomeLabel,
  recordsBefore,
  RESULT_WORDS,
  roundLabel,
  shownDecks,
  shownOutcome,
  staffReport,
  STATUS_LABELS,
  unseated
} from '../../lib/tournament/present';
import type { ManageState } from './manageState';
import { MatchTable } from './MatchTable';
import { ChampionLine, ClockControls, DeleteRound, RepairControl } from './RoundControls';

// Decks are named now and then, not every round, so their picker loads when first asked for.
const CutBracket = lazy(() => import('./Bracket').then(m => ({ default: m.CutBracket })));
// The sheet results take where rows are narrow; a desktop console never opens it.
const ResultSheet = lazy(() => import('./ResultSheet').then(m => ({ default: m.ResultSheet })));
const EventDeckPicker = lazy(() => import('./DeckPicker').then(m => ({ default: m.EventDeckPicker })));

function RoundPicker(props: { pod: Pod; selected: number; onSelect: (n: number) => void }) {
  return (
    <select class='tm-select' aria-label='Round' onChange={e => props.onSelect(Number(e.currentTarget.value))}>
      <For each={props.pod.rounds}>
        {round => (
          <option value={round.number} selected={round.number === props.selected}>
            {roundLabel(round, props.pod)}
          </option>
        )}
      </For>
    </select>
  );
}

interface Asking {
  table: number;
  p1: string;
  outcome: Outcome;
}

interface ResultProps {
  match: Match;
  /** Nothing can be entered: the result shows, the controls do not. */
  locked: boolean;
  pod: Pod;
  round: Round;
  manage: Manage;
  /** What the players reported for the match while it is open (see openReports). */
  reports: readonly PlayerReport[];
  /** The result sent for the match and not answered yet. */
  sent: Outcome | undefined;
  names: Map<string, string>;
  asking: Asking | null;
  onReport: (outcome: Outcome) => void;
  onRecord: () => void;
  onKeep: () => void;
  /** Where rows are too narrow for their controls: the result opens the table's sheet instead. */
  onOpen?: () => void;
}

/** The second press a result takes, in its row, so a slip of the finger is not a result. */
function ConfirmResult(props: ResultProps & { asking: Asking }) {
  return (
    <div
      class='tm-result is-asking'
      role='group'
      aria-label='Confirm result'
      onKeyDown={e => {
        if (e.key === 'Escape') {
          props.onKeep();
        }
      }}
    >
      <span class='tm-result-label' title={`${outcomeLabel(props.asking.outcome, props.match, props.names)}?`}>
        {outcomeLabel(props.asking.outcome, props.match, props.names)}?
      </span>
      <span class='tm-result-acts'>
        <button
          type='button'
          class='btn btn-primary tm-small'
          ref={el => queueMicrotask(() => el.focus())}
          onClick={() => props.onRecord()}
        >
          Record
        </button>
        <button type='button' class='btn btn-ghost tm-small' onClick={() => props.onKeep()}>
          Cancel
        </button>
      </span>
    </div>
  );
}

const NO_REPORTS: readonly PlayerReport[] = [];

/** A lone report staff can take as it is: one, or two that agree, and no dispute. */
const loneReport = (reports: readonly PlayerReport[]): Outcome | null =>
  reports.length > 0 && !isDisputed(reports) ? (reports[0]?.outcome ?? null) : null;

/** A round's reports by table, so each row reads its own table's and not the whole room's. */
function reportsByTable(reports: readonly PlayerReport[], pod: Pod, round: Round): Map<number, PlayerReport[]> {
  const byTable = new Map<number, PlayerReport[]>();
  for (const report of reports) {
    if (report.pod === pod.category && report.round === round.number) {
      byTable.set(report.table, [...(byTable.get(report.table) ?? []), report]);
    }
  }
  return byTable;
}

/**
 * A match's result cell, on one line: what stands (Open, or what the players
 * reported), then the controls in fixed slots so Tie, Double loss and the
 * last slot line up down the column. The last slot is Clear once a result
 * stands, or Accept while one report waits: the two never meet.
 */
function Result(props: ResultProps) {
  // A result on its way shows as sent, so the row does not read Open for as long as the answer takes.
  const shown = () =>
    props.sent
      ? { outcome: props.sent, unconfirmed: false }
      : shownOutcome(props.match, props.pod, props.round, props.manage.pending);
  const open = () => shown().outcome === 'pending';
  const elimination = () => props.round.kind === 'elimination';
  const report = createMemo(() => staffReport(props.reports, props.match, props.names));
  const lone = () => (props.reports.length > 0 && !isDisputed(props.reports) ? props.reports[0] : undefined);
  // A bye or a missed round is decided by the pairing itself: nothing to enter.
  const decidedByPairing = (
    <div class='tm-result'>
      <span class='tm-result-label'>{RESULT_WORDS[props.match.outcome]}</span>
    </div>
  );
  return (
    <Show when={props.match.p2 !== null} fallback={decidedByPairing}>
      <Show
        when={props.asking}
        fallback={
          <div class='tm-result'>
            <span
              class='tm-result-label'
              classList={{ 'is-open': open(), 'is-reported': Boolean(report()), 'is-problem': report()?.problem }}
              title={report()?.detail}
            >
              {open() ? (report()?.label ?? 'In progress') : RESULT_WORDS[shown().outcome]}
              <Show when={report()}>{r => <span class='sr-only'>. {r().detail}</span>}</Show>
              <Show when={shown().unconfirmed}>
                <span class='tm-result-sub'> not in TOM yet</span>
              </Show>
            </span>
            <Show when={props.onOpen && !props.locked}>
              <button
                type='button'
                class='tm-row-open'
                aria-label={`${open() ? 'Enter' : 'Change'} the result of table ${props.match.table}`}
                onClick={event => {
                  event.stopPropagation();
                  props.onOpen?.();
                }}
              >
                ›
              </button>
            </Show>
            <span class='tm-result-acts' classList={{ 'is-locked': props.locked || Boolean(props.onOpen) }}>
              <Show when={!elimination()}>
                <button type='button' class='btn btn-ghost tm-small' onClick={() => props.onReport('tie')}>
                  Tie
                </button>
                <button type='button' class='btn btn-ghost tm-small' onClick={() => props.onReport('double-loss')}>
                  Double loss
                </button>
              </Show>
              <span class='tm-result-slot'>
                <Show
                  when={open()}
                  fallback={
                    <button type='button' class='btn btn-ghost tm-small' onClick={() => props.onReport('pending')}>
                      Clear
                    </button>
                  }
                >
                  <Show when={lone()}>
                    {r => (
                      <button type='button' class='btn tm-small tm-accept' onClick={() => props.onReport(r().outcome)}>
                        Accept
                      </button>
                    )}
                  </Show>
                </Show>
              </span>
            </span>
          </div>
        }
      >
        {asking => <ConfirmResult {...props} asking={asking()} />}
      </Show>
    </Show>
  );
}

function matchesQuery(match: Match, query: string, names: Map<string, string>): boolean {
  const table = Number(query.trim());
  return query.trim() && Number.isInteger(table)
    ? match.table === table
    : filterMatches([match], names, query).length > 0;
}

/** The bar that finds a table: its number or a player's name, and what a press on a player does. */
function RoomFilter(props: {
  query: string;
  /** Naming decks: each seat is its player's deck picker. */
  deckMode: boolean;
  /** Whether a press on a player does anything worth saying: not while swapping, nor with every table in. */
  hint: boolean;
  onQuery: (value: string) => void;
  ref: (el: HTMLInputElement) => void;
}) {
  return (
    <div class='tm-box-bar tm-filter-bar'>
      <input
        ref={props.ref}
        class='search'
        type='search'
        placeholder='Table or player'
        aria-label='Find a table or player'
        value={props.query}
        onInput={e => props.onQuery(e.currentTarget.value)}
      />
      <Show when={props.deckMode || props.hint}>
        <span class='tm-hint'>
          {props.deckMode
            ? 'Pick each player’s deck'
            : 'Press a player to report their win, or double-click to record it'}
        </span>
      </Show>
    </div>
  );
}

/** Every table, or only those still in progress, with how many those are. */
function ShowTables(props: { openOnly: boolean; open: number; onOpenOnly: (value: boolean) => void }) {
  return (
    <div class='segmented tm-show-tables' role='tablist' aria-label='Show'>
      <button
        type='button'
        role='tab'
        class={props.openOnly ? '' : 'active'}
        aria-selected={!props.openOnly}
        onClick={() => props.onOpenOnly(false)}
      >
        All tables
      </button>
      <button
        type='button'
        role='tab'
        class={props.openOnly ? 'active' : ''}
        aria-selected={props.openOnly}
        onClick={() => props.onOpenOnly(true)}
      >
        In progress
        <Show when={props.open > 0}>
          <span class='tm-count'>{props.open}</span>
        </Show>
      </button>
    </div>
  );
}

/** The round before and after the one shown, either side of the picker. */
function RoundStepper(props: { pod: Pod; selected: number; onSelect: (n: number) => void }) {
  const index = () => props.pod.rounds.findIndex(r => r.number === props.selected);
  const step = (by: number) => {
    const next = props.pod.rounds[index() + by];
    if (next) {
      props.onSelect(next.number);
    }
  };
  return (
    <span class='tm-stepper'>
      <button
        type='button'
        class='btn btn-secondary'
        aria-label='Previous round'
        disabled={index() <= 0}
        onClick={() => step(-1)}
      >
        ‹
      </button>
      <RoundPicker pod={props.pod} selected={props.selected} onSelect={props.onSelect} />
      <button
        type='button'
        class='btn btn-secondary'
        aria-label='Next round'
        disabled={index() >= props.pod.rounds.length - 1}
        onClick={() => step(1)}
      >
        ›
      </button>
    </span>
  );
}

interface RoundBarProps {
  state: ManageState;
  pod: Pod;
  round: Round;
  tom: boolean;
  /** The round can still be acted on: its latest, no champion, not TOM's. */
  live: boolean;
  /** The round's clock can be run: its latest, no champion, TOM's or not (the site runs a TOM event's clock). */
  timed: boolean;
  played: number;
  open: number;
  waiting: boolean;
  nothingReported: boolean;
  swapMode: boolean;
  openOnly: boolean;
  /** Null while the event has archetypes off. */
  deckMode: boolean | null;
  /** The Table / Bracket switch, once the pod has a top cut to draw. */
  views?: JSX.Element;
  onPick: (round: number) => void;
  onSwap: () => void;
  onOpenOnly: (value: boolean) => void;
  onDeckMode: (value: boolean) => void;
}

/**
 * The round's bar: the picker and progress, then what can be done to it
 * (swap, re-pair, delete), then which tables show and the switch to naming decks.
 */
function RoundBar(props: RoundBarProps) {
  const swiss = () => props.round.kind === 'swiss';
  const running = () => props.live && props.round.status !== 'finished';
  return (
    <div class='tm-box-bar'>
      <RoundStepper pod={props.pod} selected={props.round.number} onSelect={props.onPick} />
      <span class='muted tm-num tm-round-state'>
        {STATUS_LABELS[props.round.status]} · {props.played - props.open} of {props.played} in
      </span>
      {props.views}
      <span class='tm-grow' />
      <Show when={props.tom}>
        <span class='muted'>Paired in TOM</span>
      </Show>
      <Show when={running() && swiss()}>
        <button
          type='button'
          class='btn btn-ghost tm-small'
          aria-pressed={props.swapMode}
          onClick={() => props.onSwap()}
        >
          {props.swapMode ? 'Cancel swap' : 'Swap players'}
        </button>
      </Show>
      <Show when={props.live && swiss() && props.open > 0 && !props.waiting}>
        <RepairControl state={props.state} pod={props.pod} label='Re-pair round' />
      </Show>
      <Show when={props.live && props.nothingReported}>
        <DeleteRound state={props.state} pod={props.pod} round={props.round} />
      </Show>
      <ShowTables openOnly={props.openOnly} open={props.open} onOpenOnly={value => props.onOpenOnly(value)} />
      <Show when={props.deckMode !== null}>
        <button
          type='button'
          class='chip tm-deck-mode'
          aria-pressed={Boolean(props.deckMode)}
          onClick={() => props.onDeckMode(!props.deckMode)}
        >
          Enter decks
        </button>
      </Show>
    </div>
  );
}

/** `locked`: a TOM event whose file needs reconnecting takes no results until the site can see it again. */
/** A phone's pinned bar: the round, and its clock while it runs, kept in reach as the tables scroll. */
function RoundPin(props: {
  state: ManageState;
  pod: Pod;
  round: Round;
  clocked: boolean;
  onPick: (n: number) => void;
}) {
  // Mounted on a phone only, so a wider screen does not run a second clock.
  const phone = createMedia('(max-width: 640px)');
  return (
    <Show when={phone()}>
      <div class='tm-round-pin'>
        <RoundPicker pod={props.pod} selected={props.round.number} onSelect={props.onPick} />
        <Show when={props.clocked}>
          <ClockControls state={props.state} pod={props.pod} round={props.round} />
        </Show>
      </div>
    </Show>
  );
}

/** The sheet for one table, reading what stands and what its players reported (see ResultSheet). */
function TableSheet(props: {
  manage: Manage;
  pod: Pod;
  round: Round;
  match: Match;
  names: Map<string, string>;
  sent: Outcome | undefined;
  reports: readonly PlayerReport[];
  onPick: (outcome: Outcome) => void;
  onClose: () => void;
}) {
  const outcome = () => props.sent ?? shownOutcome(props.match, props.pod, props.round, props.manage.pending).outcome;
  return (
    <Suspense>
      <ResultSheet
        match={props.match}
        round={props.round}
        names={props.names}
        decks={shownDecks(props.manage)}
        records={recordsBefore(withSwiss(props.manage.tournament, props.pod), props.round)}
        outcome={outcome()}
        report={staffReport(props.reports, props.match, props.names) ?? null}
        lone={loneReport(props.reports)}
        onPick={outcome => props.onPick(outcome)}
        onClose={() => props.onClose()}
      />
    </Suspense>
  );
}

/** Whether `query` matches, kept up as the window changes. */
function createMedia(query: string): () => boolean {
  const list = window.matchMedia(query);
  const [matches, setMatches] = createSignal(list.matches);
  const update = () => setMatches(list.matches);
  list.addEventListener('change', update);
  onCleanup(() => list.removeEventListener('change', update));
  return matches;
}

/**
 * Where a result is entered: in its row on a wide screen, or, 900px and under
 * where a row is too narrow for its controls, in a sheet the row opens. Not
 * while seats are being swapped or the file is locked (`held`), nor while
 * decks are being named, when a press on a seat is for its picker.
 */
function createRowSheet(held: () => boolean, naming: () => boolean) {
  const narrow = createMedia('(max-width: 900px)');
  const [open, setOpen] = createSignal<{ table: number; p1: string } | null>(null);
  const opens = () => narrow() && !held() && !naming();
  // A sheet hidden by a wider window, a swap or naming decks stays closed when they end.
  createEffect(() => {
    if (!opens()) {
      setOpen(null);
    }
  });
  return {
    opens,
    inRow: () => !held() && !opens(),
    openSheet: (match: Match) => setOpen({ table: match.table, p1: match.p1 }),
    closeSheet: () => setOpen(null),
    sheetMatch: (round: Round) => {
      const want = open();
      return want && opens() ? round.matches.find(m => m.table === want.table && m.p1 === want.p1) : undefined;
    }
  };
}

/** Trading two players' seats: a press on one, then the other, sends the swap. */
function createSwap(state: () => ManageState, pod: () => Pod) {
  const [swapMode, setSwapMode] = createSignal(false);
  const [swapPick, setSwapPick] = createSignal<string | null>(null);
  return {
    swapMode,
    swapPick,
    toggleSwap: () => {
      setSwapMode(!swapMode());
      setSwapPick(null);
    },
    pickForSwap: (id: string) => {
      const first = swapPick();
      if (first === null) {
        setSwapPick(id);
        return;
      }
      setSwapPick(null);
      setSwapMode(false);
      void state().send({ type: 'swapPlayers', pod: pod().category, a: first, b: id });
    }
  };
}

/** Who a re-pair would seat: added since the round was paired, with the way to seat them. */
function NotSeated(props: { state: ManageState; pod: Pod; names: string }) {
  return (
    <Show when={props.names}>
      <div class='tm-strip is-note' role='status'>
        <span>
          Not seated this round: <strong>{props.names}</strong>
        </span>
        <span class='tm-grow' />
        <RepairControl
          state={props.state}
          pod={props.pod}
          class='btn btn-secondary tm-small'
          label='Re-pair to seat them'
          question={`Re-pair the open tables to seat ${props.names}?`}
        />
      </div>
    </Show>
  );
}

export function RoundPanel(props: { state: ManageState; manage: Manage; pod: Pod; locked?: boolean }) {
  const tom = () => props.manage.mode === 'tom';
  const latest = () => latestRound(props.pod);
  const [picked, setPicked] = createSignal<number | null>(null);
  const { swapMode, swapPick, toggleSwap, pickForSwap } = createSwap(
    () => props.state,
    () => props.pod
  );
  const [asking, setAsking] = createSignal<Asking | null>(null);
  /**
   * Results sent and not answered yet, by match: each row shows its own until
   * the answer lands or fails. The panel outlives a switch to another division
   * or round, so a table number alone would show one on another's table.
   */
  const [sent, setSent] = createSignal<ReadonlyMap<string, Outcome>>(new Map());
  const sentKey = (r: Round, match: Match) => `${props.pod.category}|${r.number}|${match.table}|${match.p1}`;
  const [query, setQuery] = createSignal('');
  const [openOnly, setOpenOnly] = createSignal(false);
  const [deckMode, setDeckMode] = createSignal(false);
  const naming = () => deckMode() && decksEnabled(props.manage.settings);
  let filterInput: HTMLInputElement | undefined;
  const round = createMemo(() => props.pod.rounds.find(r => r.number === picked()) ?? latest());
  const names = createMemo(() => namesById(props.manage.tournament));
  const cut = createMemo(() => hasCut(props.pod));
  // Results are entered in the table, so the bracket is only ever a look at the cut.
  const [matchView, setMatchView] = createSignal<MatchView>('table');
  const asBracket = () => cut() && matchView() === 'bracket';
  const waiting = () => (tom() || latest()?.kind !== 'swiss' ? [] : unseated(props.manage.tournament, props.pod));
  const isLatest = () => round()?.number === latest()?.number;
  // Each division's champion, Masters first, once every final in the pod is decided.
  const winners = createMemo(() => champions(latest(), props.pod));
  const winner = () => winners()[0]?.id ?? null;
  const played = () => round()?.matches.filter(m => m.p2 !== null) ?? [];
  const openCount = () => {
    const r = round();
    return r
      ? played().filter(m => shownOutcome(m, props.pod, r, props.manage.pending).outcome === 'pending').length
      : 0;
  };
  const nothingReported = () => played().every(m => m.outcome === 'pending');
  /** The round's clock, run from its latest round until there is a champion, TOM's or not. */
  const timed = () => isLatest() && winner() === null;
  /** The staff controls that act on the round, offered only where its clock is and never for TOM. */
  const live = () => !tom() && timed();
  const { opens, inRow, openSheet, sheetMatch, closeSheet } = createRowSheet(
    () => swapMode() || props.locked === true,
    naming
  );
  const isAsking = (match: Match) => asking()?.table === match.table && asking()?.p1 === match.p1;
  const roundReports = createMemo(() => {
    const r = round();
    return r ? reportsByTable(props.manage.reports, props.pod, r) : new Map<number, PlayerReport[]>();
  });
  /** An open match's reports, or none once a result stands. */
  const openReports = (match: Match, r: Round): readonly PlayerReport[] =>
    shownOutcome(match, props.pod, r, props.manage.pending).outcome === 'pending'
      ? reportsFor(roundReports().get(match.table) ?? NO_REPORTS, props.pod.category, r.number, match)
      : NO_REPORTS;
  // A new round, or another division, starts on its current round again.
  createEffect(on([() => latest()?.number, () => props.pod.category], () => setPicked(null), { defer: true }));

  const shown = createMemo(() => {
    const r = round();
    if (!r) {
      return [];
    }
    return r.matches.filter(
      m =>
        (!query().trim() || matchesQuery(m, query(), names())) &&
        (!openOnly() || shownOutcome(m, props.pod, r, props.manage.pending).outcome === 'pending')
    );
  });

  function report(match: Match, outcome: Outcome) {
    setAsking({ table: match.table, p1: match.p1, outcome });
  }

  /** After a result, the filter takes focus with its text selected, ready for the next table. */
  function backToFilter() {
    filterInput?.focus();
    filterInput?.select();
  }

  /** Sends a result, and hands the filter back for the next table. */
  /** `refocus`: hand the filter back for the next table; not from the sheet, whose screen has no room for a keyboard. */
  function send(match: Match, outcome: Outcome, refocus = true) {
    const r = round();
    setAsking(null);
    if (refocus) {
      backToFilter();
    }
    if (!r) {
      return;
    }
    const { table, p1, p2 } = match;
    const key = sentKey(r, match);
    setSent(matches => new Map(matches).set(key, outcome));
    void props.state
      .send({ type: 'reportResult', pod: props.pod.category, round: r.number, table, p1, p2, outcome })
      .finally(() => setSent(matches => new Map([...matches].filter(([sentMatch]) => sentMatch !== key))));
  }

  function record(match: Match) {
    const choice = asking();
    if (choice) {
      send(match, choice.outcome);
    }
  }

  return (
    <div class='tm-panel'>
      <NotSeated
        state={props.state}
        pod={props.pod}
        names={waiting()
          .map(id => names().get(id) ?? id)
          .join(', ')}
      />
      <For each={winners()}>
        {won => (
          <ChampionLine
            label={won.division && winners().length > 1 ? `${DIVISION_LABELS[won.division]} champion` : 'Champion'}
            name={names().get(won.id) ?? won.id}
          />
        )}
      </For>
      <Show when={round()} fallback={<p class='muted'>No rounds yet.</p>}>
        {r => {
          // The room's tables with result entry; also what a cut shows when it cannot be drawn as a bracket.
          const roomTable = () => (
            <>
              <RoomFilter
                ref={el => (filterInput = el)}
                query={query()}
                deckMode={naming()}
                hint={inRow() && openCount() > 0}
                onQuery={setQuery}
              />
              <MatchTable
                pod={withSwiss(props.manage.tournament, props.pod)}
                round={r()}
                matches={shown()}
                names={names()}
                decks={shownDecks(props.manage)}
                pending={props.manage.pending}
                selected={new Set(swapPick() ? [swapPick() as string] : [])}
                onReport={inRow() ? report : undefined}
                onRecord={inRow() ? send : undefined}
                onRow={opens() ? openSheet : undefined}
                onPlayer={swapMode() ? pickForSwap : undefined}
                deckPicker={
                  naming() && !swapMode()
                    ? id => (
                        <Suspense fallback={<span class='tm-deck-pick' />}>
                          <EventDeckPicker state={props.state} manage={props.manage} playerId={id} />
                        </Suspense>
                      )
                    : undefined
                }
                inProgress={
                  openOnly()
                    ? undefined
                    : match => shownOutcome(match, props.pod, r(), props.manage.pending).outcome === 'pending'
                }
                confirming={asking()}
                sent={match => sent().get(sentKey(r(), match))}
                tag={(match, id) => staffReport(openReports(match, r()), match, names())?.tags.get(id) ?? null}
                extra={match => (
                  <Result
                    locked={props.locked ?? false}
                    match={match}
                    pod={props.pod}
                    round={r()}
                    manage={props.manage}
                    reports={openReports(match, r())}
                    sent={sent().get(sentKey(r(), match))}
                    names={names()}
                    asking={isAsking(match) ? asking() : null}
                    onReport={o => report(match, o)}
                    onRecord={() => record(match)}
                    onOpen={opens() ? () => openSheet(match) : undefined}
                    onKeep={() => {
                      setAsking(null);
                      backToFilter();
                    }}
                  />
                )}
              />
              <Show when={shown().length === 0}>
                <p class='muted tm-empty'>No tables match.</p>
              </Show>
            </>
          );
          return (
            <section class='tm-box'>
              <RoundPin
                state={props.state}
                pod={props.pod}
                round={r()}
                clocked={timed() && r().status !== 'finished' && !props.manage.settings.finished}
                onPick={setPicked}
              />
              <RoundBar
                state={props.state}
                pod={props.pod}
                round={r()}
                tom={tom()}
                live={live()}
                timed={timed()}
                played={played().length}
                open={openCount()}
                waiting={waiting().length > 0}
                nothingReported={nothingReported()}
                swapMode={swapMode()}
                openOnly={openOnly()}
                deckMode={decksEnabled(props.manage.settings) ? deckMode() : null}
                onOpenOnly={setOpenOnly}
                onDeckMode={setDeckMode}
                views={
                  <Show when={cut()}>
                    <Segmented
                      options={MATCH_VIEWS}
                      selected={matchView()}
                      onSelect={setMatchView}
                      ariaLabel='Show matches as'
                    />
                  </Show>
                }
                onPick={setPicked}
                onSwap={toggleSwap}
              />
              <Show when={swapMode()}>
                <div class='tm-box-bar tm-ask'>
                  <span>Pick two players to trade seats.</span>
                </div>
              </Show>
              <Show when={asBracket()} fallback={roomTable()}>
                <CutBracket
                  tournament={props.manage.tournament}
                  pod={props.pod}
                  pending={props.manage.pending}
                  names={names()}
                  fallback={roomTable()}
                />
              </Show>
              <Show when={sheetMatch(r())}>
                {match => (
                  <TableSheet
                    manage={props.manage}
                    pod={props.pod}
                    round={r()}
                    match={match()}
                    names={names()}
                    sent={sent().get(sentKey(r(), match()))}
                    reports={openReports(match(), r())}
                    onPick={outcome => {
                      // Read before closing: the sheet's match is gone once it closes.
                      const picked = match();
                      closeSheet();
                      send(picked, outcome, false);
                    }}
                    onClose={closeSheet}
                  />
                )}
              </Show>
            </section>
          );
        }}
      </Show>
    </div>
  );
}
