/**
 * The console's round view: the round's tables with result entry, and the
 * controls that move the event on (see RoundControls). What Slowpoke could not
 * do lives here: when a player is added after pairing, the panel says who is
 * not seated and re-pairs the round around the results already in.
 *
 * Results are entered by pressing the winner's name, then confirming in the
 * row. The filter narrows the room to one table (type its number) or player,
 * or to the tables still playing, so a result called out across the room is
 * two keystrokes and two presses away. Where players report their own, each
 * open match says what they reported, and staff accept a lone report or
 * settle a dispute by entering the result as usual.
 */

import { createEffect, createMemo, createSignal, For, on, Show } from 'solid-js';
import { isDisputed, type PlayerReport, reportsFor } from '../../../shared/tournament/reports';
import { activeIds } from '../../../shared/tournament/rounds';
import type { Match, Outcome, Pod } from '../../../shared/tournament/types';
import type { Manage } from '../../lib/tournament/api';
import {
  currentRound,
  filterMatches,
  namesById,
  roundLabel,
  shownDecks,
  shownOutcome,
  STATUS_LABELS,
  unseated
} from '../../lib/tournament/present';
import type { ManageState } from './manageState';
import { MatchTable } from './MatchTable';
import { champion, ChampionLine, ClockControls, PairingActions, RepairControl } from './RoundControls';

function RoundPicker(props: { pod: Pod; selected: number; onSelect: (n: number) => void }) {
  return (
    <select class='tm-select' aria-label='Round' onChange={e => props.onSelect(Number(e.currentTarget.value))}>
      <For each={props.pod.rounds}>
        {round => (
          <option value={round.number} selected={round.number === props.selected}>
            {roundLabel(round)}
          </option>
        )}
      </For>
    </select>
  );
}

function ResultExtras(props: { match: Match; elimination: boolean; onReport: (outcome: Outcome) => void }) {
  return (
    <Show when={props.match.p2 !== null}>
      <span class='tm-row-actions'>
        <Show when={!props.elimination}>
          <button type='button' class='btn btn-ghost tm-small' onClick={() => props.onReport('tie')}>
            Tie
          </button>
          <button type='button' class='btn btn-ghost tm-small' onClick={() => props.onReport('double-loss')}>
            Double loss
          </button>
        </Show>
        <Show when={props.match.outcome !== 'pending'}>
          <button type='button' class='btn btn-ghost tm-small' onClick={() => props.onReport('pending')}>
            Clear
          </button>
        </Show>
      </span>
    </Show>
  );
}

interface Asking {
  table: number;
  p1: string;
  outcome: Outcome;
}

const OUTCOME_WORDS: Partial<Record<Outcome, string>> = {
  tie: 'Tie',
  'double-loss': 'Double loss',
  pending: 'Clear the result'
};

function askingLabel(asking: Asking, match: Match, names: Map<string, string>): string {
  const winner = asking.outcome === 'p1' ? match.p1 : asking.outcome === 'p2' ? match.p2 : null;
  return winner ? `${names.get(winner) ?? winner} wins` : (OUTCOME_WORDS[asking.outcome] ?? '');
}

/**
 * What the players reported for an open match: one report, which staff can
 * take as it is, or two that differ, which count for nothing until staff
 * enter the result.
 */
function PlayerReports(props: {
  reports: readonly PlayerReport[];
  match: Match;
  names: Map<string, string>;
  onAccept: (outcome: Outcome) => void;
}) {
  const said = (report: PlayerReport) =>
    `${props.names.get(report.by) ?? report.by}: ${askingLabel(report, props.match, props.names)}`;
  return (
    <Show when={props.reports[0]}>
      {first => (
        <Show
          when={isDisputed(props.reports)}
          fallback={
            <span class='tm-report-note'>
              <span class='muted-cell'>Reported: {askingLabel(first(), props.match, props.names)}</span>
              <button type='button' class='btn btn-ghost tm-small' onClick={() => props.onAccept(first().outcome)}>
                Accept
              </button>
            </span>
          }
        >
          <span class='tm-report-note tm-problem'>Reports differ. {props.reports.map(said).join('; ')}</span>
        </Show>
      )}
    </Show>
  );
}

/** The second press a result takes, in the row it is for, so a slip of the finger is not a result. */
function ConfirmResult(props: { label: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <span
      class='tm-row-actions tm-confirm'
      role='group'
      aria-label='Confirm result'
      onKeyDown={e => {
        if (e.key === 'Escape') {
          props.onCancel();
        }
      }}
    >
      <span class='tm-confirm-label'>{props.label}?</span>
      <button
        type='button'
        class='btn btn-primary tm-small'
        ref={el => queueMicrotask(() => el.focus())}
        onClick={() => props.onConfirm()}
      >
        Confirm
      </button>
      <button type='button' class='btn btn-ghost tm-small' onClick={() => props.onCancel()}>
        Cancel
      </button>
    </span>
  );
}

/** Narrow the room: a table number or a name, and optionally only the tables still playing. */
function RoomFilter(props: {
  query: string;
  openOnly: boolean;
  onQuery: (value: string) => void;
  onOpenOnly: (value: boolean) => void;
  ref: (el: HTMLInputElement) => void;
}) {
  return (
    <div class='tm-toolbar tm-filter-bar'>
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
      <span class='muted tm-hint'>Press a player to report their win</span>
    </div>
  );
}

function matchesQuery(match: Match, query: string, names: Map<string, string>): boolean {
  const table = Number(query.trim());
  return query.trim() && Number.isInteger(table)
    ? match.table === table
    : filterMatches([match], names, query).length > 0;
}

export function RoundPanel(props: { state: ManageState; manage: Manage; pod: Pod }) {
  const tom = () => props.manage.mode === 'tom';
  const latest = () => currentRound(props.pod);
  const [picked, setPicked] = createSignal<number | null>(null);
  const [swapMode, setSwapMode] = createSignal(false);
  const [swapPick, setSwapPick] = createSignal<string | null>(null);
  const [asking, setAsking] = createSignal<Asking | null>(null);
  const [query, setQuery] = createSignal('');
  const [openOnly, setOpenOnly] = createSignal(false);
  let filterInput: HTMLInputElement | undefined;
  const round = createMemo(() => props.pod.rounds.find(r => r.number === picked()) ?? latest());
  const names = createMemo(() => namesById(props.manage.tournament));
  const waiting = () => (tom() || latest()?.kind !== 'swiss' ? [] : unseated(props.manage.tournament, props.pod));
  const active = () => activeIds(props.manage.tournament, props.pod).length;
  const isLatest = () => round()?.number === latest()?.number;
  const winner = () => champion(latest());
  const isAsking = (match: Match) => asking()?.table === match.table && asking()?.p1 === match.p1;
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

  function confirm(match: Match) {
    const r = round();
    const choice = asking();
    setAsking(null);
    filterInput?.focus();
    if (!r || !choice) {
      return;
    }
    const { outcome } = choice;
    void props.state.send({
      type: 'reportResult',
      pod: props.pod.category,
      round: r.number,
      table: match.table,
      p1: match.p1,
      p2: match.p2,
      outcome
    });
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

  return (
    <div class='tm-panel'>
      <Show when={!tom()}>
        <PairingActions
          state={props.state}
          pod={props.pod}
          round={latest()}
          active={active()}
          waiting={waiting().length > 0}
        />
      </Show>
      <Show when={waiting().length > 0}>
        <div class='tm-note tm-seat-note' role='status'>
          <p>
            Not seated this round:{' '}
            <strong>
              {waiting()
                .map(id => names().get(id) ?? id)
                .join(', ')}
            </strong>
          </p>
          <RepairControl state={props.state} pod={props.pod} label='Re-pair to seat them' />
        </div>
      </Show>
      <Show when={winner()}>
        {id => (
          <ChampionLine
            state={props.state}
            code={props.manage.code}
            name={names().get(id()) ?? id()}
            finished={props.manage.settings.finished}
          />
        )}
      </Show>
      <Show when={round()} fallback={<p class='muted'>No rounds yet.</p>}>
        {r => (
          <>
            <div class='tm-round-head'>
              <RoundPicker pod={props.pod} selected={r().number} onSelect={setPicked} />
              <span class='muted'>{STATUS_LABELS[r().status]}</span>
              <Show when={!tom() && isLatest() && r().kind === 'swiss' && r().status !== 'finished'}>
                <button
                  type='button'
                  class='btn btn-ghost'
                  aria-pressed={swapMode()}
                  onClick={() => {
                    setSwapMode(!swapMode());
                    setSwapPick(null);
                  }}
                >
                  {swapMode() ? 'Cancel swap' : 'Swap players'}
                </button>
              </Show>
              <Show when={!tom() && isLatest() && r().status !== 'finished'}>
                <ClockControls state={props.state} pod={props.pod} round={r()} />
              </Show>
            </div>
            <Show when={swapMode()}>
              <p class='tm-note'>Pick two players to trade seats.</p>
            </Show>
            <RoomFilter
              ref={el => (filterInput = el)}
              query={query()}
              openOnly={openOnly()}
              onQuery={setQuery}
              onOpenOnly={setOpenOnly}
            />
            <MatchTable
              pod={props.pod}
              round={r()}
              matches={shown()}
              names={names()}
              decks={shownDecks(props.manage)}
              pending={props.manage.pending}
              selected={new Set(swapPick() ? [swapPick() as string] : [])}
              onReport={swapMode() ? undefined : report}
              onPlayer={swapMode() ? pickForSwap : undefined}
              confirming={asking()}
              extra={match => (
                <Show
                  when={isAsking(match) && asking()}
                  fallback={
                    <>
                      <PlayerReports
                        reports={reportsFor(props.manage.reports, props.pod.category, r().number, match)}
                        match={match}
                        names={names()}
                        onAccept={o => report(match, o)}
                      />
                      <ResultExtras
                        match={match}
                        elimination={r().kind === 'elimination'}
                        onReport={o => report(match, o)}
                      />
                    </>
                  }
                >
                  {choice => (
                    <ConfirmResult
                      label={askingLabel(choice(), match, names())}
                      onConfirm={() => confirm(match)}
                      onCancel={() => setAsking(null)}
                    />
                  )}
                </Show>
              )}
            />
            <Show when={shown().length === 0}>
              <p class='muted tm-empty'>No tables match.</p>
            </Show>
          </>
        )}
      </Show>
    </div>
  );
}
