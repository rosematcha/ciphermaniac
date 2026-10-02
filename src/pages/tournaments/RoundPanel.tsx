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

import { createEffect, createMemo, createSignal, For, lazy, on, Show, Suspense } from 'solid-js';
import { isDisputed, type PlayerReport, reportsFor } from '../../../shared/tournament/reports';
import { latestRound, withSwiss } from '../../../shared/tournament/rounds';
import type { Match, Outcome, Pod, Round } from '../../../shared/tournament/types';
import { decksEnabled } from '../../../shared/tournament/view';
import type { Manage } from '../../lib/tournament/api';
import {
  champion,
  filterMatches,
  namesById,
  outcomeLabel,
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
              {open() ? (report()?.label ?? 'Open') : RESULT_WORDS[shown().outcome]}
              <Show when={report()}>{r => <span class='sr-only'>. {r().detail}</span>}</Show>
              <Show when={shown().unconfirmed}>
                <span class='tm-result-sub'> not in TOM yet</span>
              </Show>
            </span>
            <span class='tm-result-acts' classList={{ 'is-locked': props.locked }}>
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

/**
 * The bar that narrows the room: a table number or a name, and optionally
 * only the tables still playing; with archetypes on, the switch to naming decks.
 */
function RoomFilter(props: {
  query: string;
  openOnly: boolean;
  /** Null while the event has archetypes off. */
  deckMode: boolean | null;
  /** Whether a press on a player does anything worth saying: not while swapping, nor with every table in. */
  hint: boolean;
  onQuery: (value: string) => void;
  onOpenOnly: (value: boolean) => void;
  onDeckMode: (value: boolean) => void;
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
      <button
        type='button'
        class='chip'
        aria-pressed={props.openOnly}
        onClick={() => props.onOpenOnly(!props.openOnly)}
      >
        Open tables only
      </button>
      <Show when={props.deckMode !== null}>
        <button
          type='button'
          class='chip'
          aria-pressed={Boolean(props.deckMode)}
          onClick={() => props.onDeckMode(!props.deckMode)}
        >
          Enter decks
        </button>
      </Show>
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
  onPick: (round: number) => void;
  onSwap: () => void;
}

/** The round's bar: the picker and progress, then what can be done to it (swap, re-pair, delete, the clock). */
function RoundBar(props: RoundBarProps) {
  const swiss = () => props.round.kind === 'swiss';
  const running = () => props.live && props.round.status !== 'finished';
  return (
    <div class='tm-box-bar'>
      <RoundPicker pod={props.pod} selected={props.round.number} onSelect={props.onPick} />
      <span class='muted tm-num'>
        {STATUS_LABELS[props.round.status]} · {props.played - props.open} of {props.played} in
      </span>
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
      <Show when={props.timed && props.round.status !== 'finished'}>
        <ClockControls state={props.state} pod={props.pod} round={props.round} />
      </Show>
    </div>
  );
}

/** `locked`: a TOM event whose file needs reconnecting takes no results until the site can see it again. */
export function RoundPanel(props: { state: ManageState; manage: Manage; pod: Pod; locked?: boolean }) {
  const tom = () => props.manage.mode === 'tom';
  const latest = () => latestRound(props.pod);
  const [picked, setPicked] = createSignal<number | null>(null);
  const [swapMode, setSwapMode] = createSignal(false);
  const [swapPick, setSwapPick] = createSignal<string | null>(null);
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
  const waiting = () => (tom() || latest()?.kind !== 'swiss' ? [] : unseated(props.manage.tournament, props.pod));
  const isLatest = () => round()?.number === latest()?.number;
  const winner = () => champion(latest(), props.pod);
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
  function send(match: Match, outcome: Outcome) {
    const r = round();
    setAsking(null);
    backToFilter();
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

  function pickForSwap(id: string) {
    const first = swapPick();
    if (first === null) {
      setSwapPick(id);
      return;
    }
    setSwapPick(null);
    setSwapMode(false);
    void props.state.send({ type: 'swapPlayers', pod: props.pod.category, a: first, b: id });
  }

  const waitingNames = () =>
    waiting()
      .map(id => names().get(id) ?? id)
      .join(', ');

  return (
    <div class='tm-panel'>
      <Show when={waiting().length > 0}>
        <div class='tm-strip is-note' role='status'>
          <span>
            Not seated this round: <strong>{waitingNames()}</strong>
          </span>
          <span class='tm-grow' />
          <RepairControl
            state={props.state}
            pod={props.pod}
            class='btn btn-secondary tm-small'
            label='Re-pair to seat them'
            question={`Re-pair the open tables to seat ${waitingNames()}?`}
          />
        </div>
      </Show>
      <Show when={winner()}>{id => <ChampionLine name={names().get(id()) ?? id()} />}</Show>
      <Show when={round()} fallback={<p class='muted'>No rounds yet.</p>}>
        {r => (
          <section class='tm-box'>
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
              onPick={setPicked}
              onSwap={() => {
                setSwapMode(!swapMode());
                setSwapPick(null);
              }}
            />
            <Show when={swapMode()}>
              <div class='tm-box-bar tm-ask'>
                <span>Pick two players to trade seats.</span>
              </div>
            </Show>
            <RoomFilter
              ref={el => (filterInput = el)}
              query={query()}
              openOnly={openOnly()}
              deckMode={decksEnabled(props.manage.settings) ? deckMode() : null}
              hint={!swapMode() && !props.locked && openCount() > 0}
              onQuery={setQuery}
              onOpenOnly={setOpenOnly}
              onDeckMode={setDeckMode}
            />
            <MatchTable
              pod={withSwiss(props.manage.tournament, props.pod)}
              round={r()}
              matches={shown()}
              names={names()}
              decks={shownDecks(props.manage)}
              pending={props.manage.pending}
              selected={new Set(swapPick() ? [swapPick() as string] : [])}
              onReport={swapMode() || props.locked ? undefined : report}
              onRecord={swapMode() || props.locked ? undefined : send}
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
          </section>
        )}
      </Show>
    </div>
  );
}
