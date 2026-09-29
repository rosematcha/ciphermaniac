/**
 * The projector view (`/t/:code?screen=1`), read from across a room. Players
 * look for their own name, so the list is every player in alphabetical order
 * with their table and opponent, as TOM's printed pairings are; it flows into
 * columns on a wide screen and scrolls itself when it still does not fit. The
 * clock is the largest thing on the screen, and the event code and a QR code
 * take anyone to their own phone. Before round 1 is paired it lists everyone
 * registered, the same way, so a player can check they are in. The site's
 * chrome is hidden while it is up.
 */

import { createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import type { Pod, Round } from '../../../shared/tournament/types';
import type { TournamentView } from '../../../shared/tournament/view';
import { currentRound, namesById, recordsBefore, roundLabel } from '../../lib/tournament/present';
import { Clock } from './Clock';
import { QrCode } from './QrCode';

const STEP_MS = 40;
const PAUSE_MS = 4000;
const CONTROLS_MS = 3000;
const SCROLL_KEY = 'cm-screen-autoscroll';

/** Scrolls `el` down a pixel at a time, pausing at each end, while it overflows and `on()` holds. */
function autoScroll(el: HTMLElement, on: () => boolean): () => void {
  let pausedUntil = Date.now() + PAUSE_MS;
  const timer = setInterval(() => {
    if (!on() || Date.now() < pausedUntil || el.scrollHeight <= el.clientHeight) {
      return;
    }
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) {
      pausedUntil = Date.now() + PAUSE_MS;
      setTimeout(() => el.scrollTo({ top: 0 }), PAUSE_MS / 2);
      return;
    }
    el.scrollTop += 1;
  }, STEP_MS);
  return () => clearInterval(timer);
}

interface Seat {
  id: string;
  name: string;
  record: string;
  table: number;
  opponent: string | null;
  bye: boolean;
}

/** One row per player in the round, by last name as TOM's printed pairings are. */
function seatsOf(round: Round, pod: Pod, names: Map<string, string>, sortKey: Map<string, string>): Seat[] {
  const records = recordsBefore(pod, round);
  const seat = (id: string, opponent: string | null, table: number, bye: boolean): Seat => ({
    id,
    name: names.get(id) ?? id,
    record: records.get(id) ?? '',
    table,
    opponent: opponent === null ? null : (names.get(opponent) ?? opponent),
    bye
  });
  return round.matches
    .flatMap(m =>
      m.p2 === null
        ? [seat(m.p1, null, 0, m.outcome === 'bye')]
        : [seat(m.p1, m.p2, m.table, false), seat(m.p2, m.p1, m.table, false)]
    )
    .sort((a, b) => (sortKey.get(a.id) ?? a.name).localeCompare(sortKey.get(b.id) ?? b.name));
}

function ScreenList(props: { view: TournamentView; pod: Pod }) {
  const names = createMemo(() => namesById(props.view.tournament));
  const sortKey = createMemo(
    () => new Map(props.view.tournament.players.map(p => [p.id, `${p.lastName} ${p.firstName}`.toLowerCase()]))
  );
  const seats = () => {
    const round = currentRound(props.pod);
    return round ? seatsOf(round, props.pod, names(), sortKey()) : [];
  };
  return (
    <ol class='tm-screen-list'>
      <For each={seats()}>
        {seat => (
          <li>
            <span class='tm-screen-name'>{seat.name}</span>
            <span class='tm-screen-record num'>{seat.record}</span>
            <span class='tm-screen-table num'>{seat.table || ''}</span>
            <span class='tm-screen-opponent'>{seat.opponent ?? (seat.bye ? 'Bye' : 'Missed round')}</span>
          </li>
        )}
      </For>
    </ol>
  );
}

/** Everyone registered and not dropped, by last name, for players to find themselves before round 1. */
function Registered(props: { view: TournamentView }) {
  const names = createMemo(() => namesById(props.view.tournament));
  const players = () =>
    props.view.tournament.players
      .filter(player => player.droppedAfter === null)
      .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));
  return (
    <ol class='tm-screen-list tm-screen-registered'>
      <For each={players()}>
        {player => (
          <li>
            <span class='tm-screen-name'>{names().get(player.id)}</span>
          </li>
        )}
      </For>
    </ol>
  );
}

export function BigScreen(props: { view: TournamentView }) {
  let scroller: HTMLDivElement | undefined;
  const url = () => `${location.origin}/t/${props.view.code}`;
  const [scrolling, setScrolling] = createSignal(localStorage.getItem(SCROLL_KEY) !== 'off');
  const [controls, setControls] = createSignal(false);
  const lead = () => props.view.tournament.pods.find(pod => currentRound(pod));
  const registered = () => props.view.tournament.players.filter(player => player.droppedAfter === null).length;
  const toggleScroll = () => {
    const next = !scrolling();
    localStorage.setItem(SCROLL_KEY, next ? 'on' : 'off');
    setScrolling(next);
  };
  onMount(() => {
    document.body.classList.add('tm-screen-mode');
    const stop = scroller ? autoScroll(scroller, scrolling) : () => undefined;
    // The toggle is for whoever is at the laptop; the room never needs to see it.
    let hide: ReturnType<typeof setTimeout> | undefined;
    const reveal = () => {
      setControls(true);
      clearTimeout(hide);
      hide = setTimeout(() => setControls(false), CONTROLS_MS);
    };
    document.addEventListener('pointermove', reveal);
    onCleanup(() => {
      stop();
      clearTimeout(hide);
      document.removeEventListener('pointermove', reveal);
      document.body.classList.remove('tm-screen-mode');
    });
  });
  return (
    <div class='tm-screen'>
      <header class='tm-screen-head'>
        <div>
          <h1 class='tm-screen-title'>{props.view.tournament.info.name}</h1>
          <Show when={lead()} fallback={<p class='tm-screen-round num'>{registered()} registered</p>}>
            {pod => <p class='tm-screen-round'>{roundLabel(currentRound(pod()) as Round)}</p>}
          </Show>
        </div>
        <Show when={lead()}>{pod => <Clock round={currentRound(pod()) as Round} class='tm-screen-clock' />}</Show>
      </header>
      <div class='tm-screen-main' ref={scroller}>
        <Show when={lead()} fallback={<Registered view={props.view} />}>
          <For each={props.view.tournament.pods.filter(pod => currentRound(pod))}>
            {pod => <ScreenList view={props.view} pod={pod} />}
          </For>
        </Show>
      </div>
      <aside class='tm-screen-side'>
        <QrCode text={url()} label='Event page QR code' />
        <p class='tm-screen-code num'>{props.view.code}</p>
        <p class='tm-screen-url'>{url().replace(/^https?:\/\//, '')}</p>
        <button
          type='button'
          class='btn btn-secondary tm-screen-toggle'
          classList={{ 'is-shown': controls() }}
          aria-pressed={scrolling()}
          onClick={toggleScroll}
          onFocus={() => setControls(true)}
        >
          Auto scroll {scrolling() ? 'on' : 'off'}
        </button>
      </aside>
    </div>
  );
}
