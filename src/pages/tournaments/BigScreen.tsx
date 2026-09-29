/**
 * The projector view (`/t/:code?screen=1`), read from across a room. Tables
 * run in order, one per row with large names, or two per row where there are
 * many; each row is the table number, then both players with the record they
 * brought into the round. As results come in, the winner is marked and the
 * loser fades, so the room sees who won and which tables are still playing.
 * The list scrolls itself when it does not fit, at
 * the speed set on the screen. The header carries the event's status, a QR
 * code and the event code for anyone who would rather look at their phone,
 * and the clock, the largest thing on the screen. Before round 1 is paired it
 * lists everyone registered, so a player can check they are in.
 *
 * Rows per line and the scroll speed are for whoever is at the laptop: the
 * controls show while the pointer moves, S cycles the speed, and both are
 * remembered on the device. The site's chrome is hidden while it is up.
 */

import { createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { swissStandings } from '../../../shared/tournament/standings';
import { type Pod, POD_LABELS, type Round } from '../../../shared/tournament/types';
import type { TournamentView } from '../../../shared/tournament/view';
import { Segmented } from '../../components/Segmented';
import {
  currentRound,
  eventStatus,
  namesById,
  recordsBefore,
  seatMark,
  shownOutcome
} from '../../lib/tournament/present';
import { sortMatches } from '../../../shared/tournament/rounds';
import { Clock } from './Clock';
import { createNow } from './now';
import { QrCode } from './QrCode';
import '../../styles/pages/tournament-screen.css';

const STEP_MS = 40;
const PAUSE_MS = 4000;
const CONTROLS_MS = 3000;
const SPEED_KEY = 'cm-screen-autoscroll';
const PER_ROW_KEY = 'cm-screen-per-row';

type Speed = 'off' | 'slow' | 'moderate' | 'fast';

const SPEEDS: { value: Speed; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'slow', label: 'Slow' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'fast', label: 'Fast' }
];

/** Pixels per step: the shipped pace of a pixel every 40ms is Slow. */
const PIXELS: Record<Speed, number> = { off: 0, slow: 1, moderate: 2, fast: 4 };

/** The stored speed; an older "on" is the old pace, Slow. */
function storedSpeed(): Speed {
  const stored = localStorage.getItem(SPEED_KEY);
  if (stored === 'on') {
    return 'slow';
  }
  return SPEEDS.some(s => s.value === stored) ? (stored as Speed) : 'slow';
}

/** Scrolls `el` down `step()` pixels at a time, pausing at each end, while it overflows. */
function autoScroll(el: HTMLElement, step: () => number): () => void {
  let pausedUntil = Date.now() + PAUSE_MS;
  const timer = setInterval(() => {
    if (step() === 0 || Date.now() < pausedUntil || el.scrollHeight <= el.clientHeight) {
      return;
    }
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) {
      pausedUntil = Date.now() + PAUSE_MS;
      setTimeout(() => el.scrollTo({ top: 0 }), PAUSE_MS / 2);
      return;
    }
    el.scrollTop += step();
  }, STEP_MS);
  return () => clearInterval(timer);
}

function createScreenPrefs() {
  const [speed, setSpeedSignal] = createSignal<Speed>(storedSpeed());
  const [two, setTwoSignal] = createSignal(localStorage.getItem(PER_ROW_KEY) === '2');
  const setSpeed = (next: Speed) => {
    localStorage.setItem(SPEED_KEY, next);
    setSpeedSignal(next);
  };
  const cycle = () => setSpeed(SPEEDS[(SPEEDS.findIndex(s => s.value === speed()) + 1) % SPEEDS.length].value);
  const toggleTwo = () => {
    localStorage.setItem(PER_ROW_KEY, two() ? '1' : '2');
    setTwoSignal(!two());
  };
  return { speed, setSpeed, cycle, two, toggleTwo };
}

type Prefs = ReturnType<typeof createScreenPrefs>;

/** A seat at a table: the name and record, the seed in a top cut, and once the table is done, how it went. */
function ScreenSeat(props: { id: string | null; name: string; record: string; seed?: number; mark: string }) {
  return (
    <span
      class='tm-screen-seat'
      classList={{ 'is-win': props.mark === 'W', 'is-out': props.mark === 'L', 'is-tie': props.mark === 'T' }}
    >
      <span class='tm-screen-name'>
        <Show when={props.seed}>{seed => <small class='num'>{seed()}</small>}</Show>
        <span class='tm-screen-name-text'>{props.name}</span>
        <Show when={props.mark}>
          {mark => (
            <span class='tm-screen-mark' aria-label={MARK_WORDS[mark()]}>
              {mark()}
            </span>
          )}
        </Show>
      </span>
      <span class='tm-screen-record num'>{props.record}</span>
    </span>
  );
}

const MARK_WORDS: Record<string, string> = { W: 'Won', L: 'Lost', T: 'Tie' };

/** A pod's tables in order, table number first. */
function TableRows(props: { view: TournamentView; pod: Pod; round: Round; heading: boolean }) {
  const names = createMemo(() => namesById(props.view.tournament));
  const records = () => recordsBefore(props.pod, props.round);
  const seeds = createMemo(() =>
    props.round.kind === 'elimination'
      ? new Map(swissStandings(props.pod, props.view.tournament.players).map(row => [row.playerId, row.place]))
      : new Map<string, number>()
  );
  /** W, L or T by a seat once its table has a result; a bye or a missed round is not a table. */
  const mark = (match: Round['matches'][number], seat: 1 | 2) =>
    match.p2 === null ? '' : seatMark(shownOutcome(match, props.pod, props.round, props.view.pending).outcome, seat);
  const seat = (id: string | null, seatMarkText: string, fallback: string) => (
    <ScreenSeat
      id={id}
      name={id ? (names().get(id) ?? id) : fallback}
      record={id ? (records().get(id) ?? '') : ''}
      seed={id ? seeds().get(id) : undefined}
      mark={seatMarkText}
    />
  );
  return (
    <section class='tm-screen-pod'>
      <Show when={props.heading}>
        <h2 class='tm-screen-pod-head'>{POD_LABELS[props.pod.category]}</h2>
      </Show>
      <ol class='tm-screen-tables'>
        <For each={sortMatches(props.round.matches)}>
          {match => (
            <li classList={{ 'is-done': mark(match, 1) !== '' }}>
              <span class='tm-screen-table num'>{match.table || '—'}</span>
              {seat(match.p1, mark(match, 1), '')}
              {seat(match.p2, mark(match, 2), match.outcome === 'bye' ? 'Bye' : 'Missed round')}
            </li>
          )}
        </For>
      </ol>
    </section>
  );
}

/** Everyone registered and not dropped, by last name, for players to find themselves before round 1. */
function Registered(props: { view: TournamentView }) {
  const players = () =>
    props.view.tournament.players
      .filter(player => player.droppedAfter === null)
      .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));
  return (
    <ol class='tm-screen-registered'>
      <For each={players()}>
        {player => (
          <li>
            {player.firstName} <strong>{player.lastName}</strong>
          </li>
        )}
      </For>
    </ol>
  );
}

function Controls(props: { prefs: Prefs; shown: boolean; tables: boolean; onFocus: () => void }) {
  return (
    <div class='tm-screen-controls' classList={{ 'is-shown': props.shown }} onFocusIn={() => props.onFocus()}>
      <Show when={props.tables}>
        <button type='button' class='btn btn-secondary tm-small' onClick={() => props.prefs.toggleTwo()}>
          {props.prefs.two() ? 'Show one per row' : 'Show two per row'}
        </button>
      </Show>
      <span class='tm-screen-speed'>
        <strong>Auto scroll</strong>
        <Segmented
          options={SPEEDS}
          selected={props.prefs.speed()}
          onSelect={value => props.prefs.setSpeed(value)}
          ariaLabel='Auto scroll speed'
        />
      </span>
    </div>
  );
}

const firstRoundTime = (startsAt: string) =>
  startsAt ? new Date(startsAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : null;

export function BigScreen(props: { view: TournamentView }) {
  let scroller: HTMLDivElement | undefined;
  const prefs = createScreenPrefs();
  const now = createNow();
  const [controls, setControls] = createSignal(false);
  const url = () => `${location.origin}/t/${props.view.code}`;
  const pods = () => props.view.tournament.pods.filter(pod => currentRound(pod));
  const lead = () => pods()[0];
  // An ended event has no clock to run down, whatever it was left on.
  const clockPod = () => (props.view.settings.finished ? undefined : lead());
  const firstRound = () => firstRoundTime(props.view.settings.startsAt);
  const status = () =>
    eventStatus(
      props.view.tournament,
      { pending: props.view.pending, finished: props.view.settings.finished, firstRound: firstRound() },
      now()
    );
  let hide: ReturnType<typeof setTimeout> | undefined;
  const reveal = () => {
    setControls(true);
    clearTimeout(hide);
    hide = setTimeout(() => setControls(false), CONTROLS_MS);
  };
  onMount(() => {
    document.body.classList.add('tm-screen-mode');
    const stop = scroller ? autoScroll(scroller, () => PIXELS[prefs.speed()]) : () => undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 's' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        prefs.cycle();
        reveal();
      }
    };
    document.addEventListener('pointermove', reveal);
    document.addEventListener('keydown', onKey);
    onCleanup(() => {
      stop();
      clearTimeout(hide);
      document.removeEventListener('pointermove', reveal);
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('tm-screen-mode');
    });
  });
  return (
    <div class='tm-screen' classList={{ 'is-two': prefs.two() }}>
      <header class='tm-screen-head'>
        <div class='tm-screen-text'>
          <h1 class='tm-screen-title'>{props.view.tournament.info.name}</h1>
          <p class='tm-screen-status'>
            <strong>{status()[0]}</strong>
            <Show when={status().length > 1}>
              <span class='muted'> · {status().slice(1).join(' · ')}</span>
            </Show>
          </p>
        </div>
        <div class='tm-screen-join'>
          <QrCode text={url()} label='Event page QR code' />
          <div>
            <p class='tm-screen-code num'>{props.view.code}</p>
            <p class='tm-screen-url'>{url().replace(/^https?:\/\//, '')}</p>
          </div>
        </div>
        <Show
          when={clockPod()}
          fallback={
            <Show when={!lead() && firstRound()}>
              {time => (
                <p class='tm-screen-start'>
                  <small>Round 1</small>
                  <span class='num'>{time()}</span>
                </p>
              )}
            </Show>
          }
        >
          {pod => <Clock round={currentRound(pod()) as Round} class='tm-screen-clock' />}
        </Show>
      </header>
      <div class='tm-screen-main' ref={scroller}>
        <Show when={lead()} fallback={<Registered view={props.view} />}>
          <For each={pods()}>
            {pod => (
              <TableRows view={props.view} pod={pod} round={currentRound(pod) as Round} heading={pods().length > 1} />
            )}
          </For>
        </Show>
      </div>
      <Controls prefs={prefs} shown={controls()} tables={Boolean(lead())} onFocus={reveal} />
    </div>
  );
}
