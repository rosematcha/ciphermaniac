/**
 * The projector view (`/t/:code?screen=1`), read from across a room. It
 * follows the event through five layouts (see screenPhase), each rising in
 * as the last gives way:
 *
 * Before round 1, everyone registered by first name, for a player to check
 * they are in, beside a large QR code and the event code. Once a round is
 * paired, its tables in order: both players face each other across the
 * table number, each with the record they brought into the round. Once the
 * clock starts, the clock is the largest thing on the screen and the tables
 * run under it. Once every table has a result, the tables again with each
 * result in the middle, for the room to check before the next round. Once
 * the event ends, the standings.
 *
 * Every list scrolls itself when it does not fit, at the speed set on the
 * screen. The header carries the event's name and status, and after round 1
 * a small QR code and the event code. The scroll speed, and once a top cut
 * has started whether it shows as tables or as a bracket, are for whoever is
 * at the laptop: the controls show while the pointer moves, S cycles the
 * speed, B switches the view, and both are remembered on the device. The
 * site's chrome is hidden while it is up.
 */

import { createMemo, createSignal, For, Index, type JSX, lazy, onCleanup, onMount, Show } from 'solid-js';
import { percentLabel, recordLabel } from '../../../shared/tournament/standings';
import type { Match, Pod, Round } from '../../../shared/tournament/types';
import type { TournamentView } from '../../../shared/tournament/view';
import { Segmented } from '../../components/Segmented';
import { cutSeeds } from '../../lib/tournament/bracket';
import {
  divisionHeading,
  eventStatus,
  firstRoundTime,
  hasCut,
  MATCH_VIEWS,
  type MatchView,
  namesById,
  podLabel,
  podStandings,
  recordsBefore,
  roundCapOf,
  seatMark,
  shownOutcome
} from '../../lib/tournament/present';
import { type ScreenPhase, screenPhase } from '../../lib/tournament/screen';
import { latestRound, livePods, sortMatches, withSwiss } from '../../../shared/tournament/rounds';
import { Clock } from './Clock';
import { createNow } from './now';
import { QrCode } from './QrCode';
import '../../styles/pages/tournament-screen.css';

const STEP_MS = 40;
const PAUSE_MS = 4000;
const CONTROLS_MS = 3000;
const SPEED_KEY = 'cm-screen-autoscroll';
const VIEW_KEY = 'cm-screen-view';

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
  const setSpeed = (next: Speed) => {
    localStorage.setItem(SPEED_KEY, next);
    setSpeedSignal(next);
  };
  const cycle = () => setSpeed(SPEEDS[(SPEEDS.findIndex(s => s.value === speed()) + 1) % SPEEDS.length].value);
  const [view, setViewSignal] = createSignal<MatchView>(
    localStorage.getItem(VIEW_KEY) === 'bracket' ? 'bracket' : 'table'
  );
  const setView = (next: MatchView) => {
    localStorage.setItem(VIEW_KEY, next);
    setViewSignal(next);
  };
  const toggleView = () => setView(view() === 'bracket' ? 'table' : 'bracket');
  return { speed, setSpeed, cycle, view, setView, toggleView };
}

type Prefs = ReturnType<typeof createScreenPrefs>;

/** A list that scrolls itself at the screen's speed while it overflows. */
function Scroller(props: { prefs: Prefs; class?: string; children: JSX.Element }) {
  let el: HTMLDivElement | undefined;
  onMount(() => {
    if (el) {
      onCleanup(autoScroll(el, () => PIXELS[props.prefs.speed()]));
    }
  });
  return (
    <div class={`tm-screen-scroll ${props.class ?? ''}`} ref={el}>
      {props.children}
    </div>
  );
}

/** A seat at a table: the name and record, the seed in a top cut, and once the table is done, how it went. */
function ScreenSeat(props: { name: string; record: string; seed?: number; mark: string }) {
  return (
    <span
      class='tm-screen-seat'
      classList={{ 'is-win': props.mark === 'W', 'is-out': props.mark === 'L', 'is-tie': props.mark === 'T' }}
    >
      <span class='tm-screen-name'>
        <Show when={props.seed}>{seed => <small class='num'>{seed()}</small>}</Show>
        <span class='tm-screen-name-text'>{props.name}</span>
      </span>
      <span class='tm-screen-record num'>{props.record}</span>
    </span>
  );
}

const MARK_WORDS: Record<string, string> = { W: 'Won', L: 'Lost', T: 'Tie' };

/** The middle of a table: its number, and once it has a result, each seat's mark facing its player. */
function TableMiddle(props: { table: number; marks: [string, string] }) {
  return (
    <span class='tm-screen-mid'>
      <span class='tm-screen-table num'>{props.table || '—'}</span>
      <Show when={props.marks[0]} fallback={<small>Table</small>}>
        <span class='tm-screen-score'>
          <For each={props.marks}>
            {mark => (
              <span class='tm-screen-mark' aria-label={MARK_WORDS[mark]}>
                {mark}
              </span>
            )}
          </For>
        </span>
      </Show>
    </span>
  );
}

/** A pod's tables in order, the players facing each other across the table number. */
function TableRows(props: { view: TournamentView; pod: Pod; round: Round; heading: boolean }) {
  const names = createMemo(() => namesById(props.view.tournament));
  // A division's top cut reads its records and seeds from the Swiss rounds that seeded it, among its own players.
  const played = createMemo(() => withSwiss(props.view.tournament, props.pod));
  const records = createMemo(() => recordsBefore(played(), props.round));
  const seeds = createMemo(() =>
    props.round.kind === 'elimination' ? cutSeeds(props.view.tournament, props.pod) : new Map<string, number>()
  );
  /** W, L or T by each seat once its table has a result; a bye or a missed round is not a table. */
  const marks = (match: Match): [string, string] => {
    if (match.p2 === null) {
      return ['', ''];
    }
    const { outcome } = shownOutcome(match, props.pod, props.round, props.view.pending);
    return [seatMark(outcome, 1), seatMark(outcome, 2)];
  };
  const seat = (id: string | null, mark: string, fallback: string) => (
    <ScreenSeat
      name={id ? (names().get(id) ?? id) : fallback}
      record={id ? (records().get(id) ?? '') : ''}
      seed={id ? seeds().get(id) : undefined}
      mark={mark}
    />
  );
  return (
    <section class='tm-screen-pod'>
      <Show when={props.heading}>
        <h2 class='tm-screen-pod-head'>{podLabel(props.pod)}</h2>
      </Show>
      <ol class='tm-screen-tables'>
        <For each={sortMatches(props.round.matches)}>
          {match => (
            <li classList={{ 'is-done': marks(match)[0] !== '' }}>
              {seat(match.p1, marks(match)[0], '')}
              <TableMiddle table={match.table} marks={marks(match)} />
              {seat(match.p2, marks(match)[1], match.outcome === 'bye' ? 'Bye' : 'Missed round')}
            </li>
          )}
        </For>
      </ol>
    </section>
  );
}

/** Everyone registered and not dropped, by first name, for players to find themselves before round 1. */
function Registered(props: { view: TournamentView }) {
  const players = () =>
    props.view.tournament.players
      .filter(player => player.droppedAfter === null)
      .sort((a, b) => a.firstName.localeCompare(b.firstName) || a.lastName.localeCompare(b.lastName));
  return (
    <ol class='tm-screen-registered'>
      <For each={players()}>
        {player => (
          <li>
            <strong>{player.firstName}</strong> {player.lastName}
          </li>
        )}
      </For>
    </ol>
  );
}

const CutBracket = lazy(() => import('./Bracket').then(m => ({ default: m.CutBracket })));

/**
 * A pod's top cut as a bracket, under the pod's name when the screen shows
 * several; its tables when the cut cannot be drawn as one.
 */
function BracketRows(props: { view: TournamentView; pod: Pod; heading: boolean }) {
  const names = createMemo(() => namesById(props.view.tournament));
  return (
    <section class='tm-screen-pod'>
      <Show when={props.heading}>
        <h2 class='tm-screen-pod-head'>{podLabel(props.pod)}</h2>
      </Show>
      <CutBracket
        tournament={props.view.tournament}
        pod={props.pod}
        pending={props.view.pending}
        names={names()}
        class='is-screen'
        fallback={
          <TableRows view={props.view} pod={props.pod} round={latestRound(props.pod) as Round} heading={false} />
        }
      />
    </section>
  );
}

/** Every pod's current round, as tables or, for a top cut the screen is set to, a bracket. */
function Matches(props: { view: TournamentView; pods: Pod[]; prefs: Prefs }) {
  const asBracket = (pod: Pod) => props.prefs.view() === 'bracket' && hasCut(pod);
  return (
    // By position: a result changes its pod, and a pod drawn again from nothing would
    // send the room's scroll back to the top.
    <Index each={props.pods}>
      {pod => (
        <Show
          when={asBracket(pod())}
          fallback={
            <TableRows
              view={props.view}
              pod={pod()}
              round={latestRound(pod()) as Round}
              heading={props.pods.length > 1}
            />
          }
        >
          <BracketRows view={props.view} pod={pod()} heading={props.pods.length > 1} />
        </Show>
      )}
    </Index>
  );
}

/** Each pod's final standings, a table per division, under its name when there are several. */
function Standings(props: { view: TournamentView; pods: Pod[] }) {
  const names = createMemo(() => namesById(props.view.tournament));
  const divisionOf = (id: string) => props.view.divisions[id] ?? 'masters';
  const groups = createMemo(() =>
    props.pods.flatMap(pod =>
      podStandings(props.view.tournament, pod, divisionOf).map(group => ({
        heading: group.division ? divisionHeading(group.division) : podLabel(pod),
        rows: group.rows
      }))
    )
  );
  return (
    <For each={groups()}>
      {group => (
        <section class='tm-screen-pod'>
          <Show when={groups().length > 1}>
            <h2 class='tm-screen-pod-head'>{group.heading}</h2>
          </Show>
          <table class='tm-screen-standings num'>
            <thead>
              <tr>
                <th>#</th>
                <th>Player</th>
                <th>Record</th>
                <th>Points</th>
                <th>Opp. win</th>
              </tr>
            </thead>
            <tbody>
              <For each={group.rows}>
                {row => (
                  <tr>
                    <td class='tm-screen-place'>{row.place}</td>
                    <td class='tm-screen-player'>{names().get(row.playerId) ?? row.playerId}</td>
                    <td>{recordLabel(row.record)}</td>
                    <td class='tm-screen-points'>{row.points}</td>
                    <td>{percentLabel(row.owp)}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </section>
      )}
    </For>
  );
}

/** The QR code to the event page, with the code and address for anyone who would rather type it. */
function Join(props: { url: string; large?: boolean; children?: JSX.Element }) {
  return (
    <div class='tm-screen-join' classList={{ 'is-large': props.large }}>
      <QrCode text={props.url} label='Event page QR code' />
      <div>
        <p class='tm-screen-code num'>{props.url.split('/').pop()}</p>
        <p class='tm-screen-url'>{props.url.replace(/^https?:\/\//, '')}</p>
        {props.children}
      </div>
    </div>
  );
}

function Controls(props: { prefs: Prefs; shown: boolean; bracket: boolean; onFocus: () => void }) {
  return (
    <div class='tm-screen-controls' classList={{ 'is-shown': props.shown }} onFocusIn={() => props.onFocus()}>
      <Show when={props.bracket}>
        <Segmented
          options={MATCH_VIEWS}
          selected={props.prefs.view()}
          onSelect={value => props.prefs.setView(value)}
          ariaLabel='Show matches as'
        />
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

/** What the screen shows under its header, for the phase the event is in. */
function PhaseBody(props: {
  phase: ScreenPhase;
  view: TournamentView;
  pods: Pod[];
  prefs: Prefs;
  url: string;
  label: string;
}) {
  const firstRound = () => firstRoundTime(props.view.settings.startsAt);
  const matches = () => (
    <Scroller prefs={props.prefs}>
      <Matches view={props.view} pods={props.pods} prefs={props.prefs} />
    </Scroller>
  );
  const views: Record<ScreenPhase, () => JSX.Element> = {
    roster: () => (
      <div class='tm-screen-before'>
        <Scroller prefs={props.prefs}>
          <Registered view={props.view} />
        </Scroller>
        <Join url={props.url} large>
          <Show when={firstRound()}>{time => <p class='tm-screen-first num'>Round 1 at {time()}</p>}</Show>
        </Join>
      </div>
    ),
    paired: matches,
    results: matches,
    clock: () => (
      <div class='tm-screen-timing'>
        <div class='tm-screen-big-clock'>
          <Clock round={latestRound(props.pods[0]) as Round} class='tm-screen-clock' />
          <p>{props.label}</p>
        </div>
        {matches()}
      </div>
    ),
    standings: () => (
      <Scroller prefs={props.prefs}>
        <Standings view={props.view} pods={props.pods} />
      </Scroller>
    )
  };
  return <div class={`tm-screen-main is-${props.phase}`}>{views[props.phase]()}</div>;
}

export function BigScreen(props: { view: TournamentView }) {
  const prefs = createScreenPrefs();
  const now = createNow();
  const [controls, setControls] = createSignal(false);
  const url = () => `${location.origin}/t/${props.view.code}`;
  const pods = () => livePods(props.view.tournament).filter(pod => latestRound(pod));
  const anyBracket = createMemo(() => pods().some(hasCut));
  const phase = createMemo(() => screenPhase(pods(), props.view.pending, props.view.settings.finished));
  const status = () =>
    eventStatus(
      props.view.tournament,
      {
        pending: props.view.pending,
        finished: props.view.settings.finished,
        firstRound: firstRoundTime(props.view.settings.startsAt),
        roundCap: roundCapOf(props.view)
      },
      now()
    );
  // The clock's own words would repeat the clock under the header.
  const statusShown = () => (phase() === 'clock' ? status().slice(0, 2) : status());
  let hide: ReturnType<typeof setTimeout> | undefined;
  const reveal = () => {
    setControls(true);
    clearTimeout(hide);
    hide = setTimeout(() => setControls(false), CONTROLS_MS);
  };
  onMount(() => {
    document.body.classList.add('tm-screen-mode');
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === 's') {
        prefs.cycle();
        reveal();
      } else if (key === 'b' && anyBracket()) {
        prefs.toggleView();
        reveal();
      }
    };
    document.addEventListener('pointermove', reveal);
    document.addEventListener('keydown', onKey);
    onCleanup(() => {
      clearTimeout(hide);
      document.removeEventListener('pointermove', reveal);
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('tm-screen-mode');
    });
  });
  return (
    <div class='tm-screen'>
      <header class='tm-screen-head'>
        <div class='tm-screen-text'>
          <h1 class='tm-screen-title'>{props.view.tournament.info.name}</h1>
          <p class='tm-screen-status'>
            <strong>{statusShown()[0]}</strong>
            <Show when={statusShown().length > 1}>
              <span class='muted'> · {statusShown().slice(1).join(' · ')}</span>
            </Show>
          </p>
        </div>
        <Show when={phase() !== 'roster'}>
          <Join url={url()} />
        </Show>
      </header>
      {/* Keyed by phase, so each layout rises in as the last gives way. */}
      <Show when={phase()} keyed>
        {current => (
          <PhaseBody
            phase={current}
            view={props.view}
            pods={pods()}
            prefs={prefs}
            url={url()}
            label={status()[0] ?? ''}
          />
        )}
      </Show>
      <Controls prefs={prefs} shown={controls()} bracket={anyBracket()} onFocus={reveal} />
    </div>
  );
}
