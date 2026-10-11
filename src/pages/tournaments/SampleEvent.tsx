/**
 * The /host home page's hero picture: a sixteen-player event playing itself,
 * paired round by round by the engine real events run on (see
 * lib/tournament/sampleEvent.ts). Results land a table at a time and the
 * standings' top eight move as they do; at the end it rests, then plays a
 * new event in a new seat order. Under reduced motion it shows the finished
 * event, at rest.
 */

import { batch, createMemo, createSignal, For, Match, onCleanup, onMount, Switch } from 'solid-js';
import { seededRandom, shuffled } from '../../../shared/tournament/random';
import {
  playSampleEvent,
  SAMPLE_PLAYERS,
  type SampleStanding,
  sampleStandings,
  type SampleTable
} from '../../lib/tournament/sampleEvent';

const ROUNDS = 5;
/** Rows the standings show: the top eight. */
const SHOWN = 8;
/** Milliseconds between results landing. */
const BEAT = 260;
/** A beat to read a finished round before the next is paired. */
const READ = 1400;
/** How long the final standings rest before a new event starts. */
const REST = 4000;

interface Run {
  players: string[];
  rounds: SampleTable[][];
}

function newRun(): Run {
  const random = seededRandom(Date.now() % 100_000);
  const players = shuffled(SAMPLE_PLAYERS, random);
  return { players, rounds: playSampleEvent(players, ROUNDS, random) };
}

/** A table's line: who plays whom, then who beat whom once the result lands. */
function TableLine(props: { table: SampleTable; done: boolean }) {
  const loser = () => (props.table.winner === props.table.p1 ? props.table.p2 : props.table.p1);
  return (
    <Switch
      fallback={
        <>
          <b>{props.table.winner}</b> <em>beat</em> {loser() ?? 'Bye'}
        </>
      }
    >
      <Match when={!props.done}>
        {props.table.p1} <em>vs</em> {props.table.p2 ?? 'Bye'}
      </Match>
      <Match when={props.table.winner === null}>
        {props.table.p1} <em>tied</em> {props.table.p2}
      </Match>
    </Switch>
  );
}

/** A player's row, placed by rank; rows past the top eight sit clipped below it. */
function StandingRow(props: { name: string; at: { line: SampleStanding; i: number } | undefined }) {
  const i = () => props.at?.i ?? 0;
  const record = () => {
    const line = props.at?.line;
    return line ? `${line.wins}-${line.losses}-${line.ties}` : '0-0-0';
  };
  return (
    <li class='tm-sim-row' style={{ '--rank': i() }}>
      <span class='tm-sim-n'>{i() + 1}</span>
      <span class='tm-sim-who'>{props.name}</span>
      <em>{record()}</em>
    </li>
  );
}

export function SampleEvent() {
  const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [run, setRun] = createSignal(newRun());
  const [round, setRound] = createSignal(0);
  const [landed, setLanded] = createSignal(0);
  const [finished, setFinished] = createSignal(false);
  let timers: number[] = [];
  const later = (ms: number, then: () => void) => timers.push(window.setTimeout(then, ms));
  const stop = () => {
    timers.forEach(clearTimeout);
    timers = [];
  };

  const tables = () => run().rounds[round() - 1] ?? [];
  const results = createMemo(() => [
    ...run()
      .rounds.slice(0, Math.max(0, round() - 1))
      .flat(),
    ...tables().slice(0, landed())
  ]);
  const standings = createMemo(() => sampleStandings(run().players, results()));
  const top = () => standings().slice(0, SHOWN);
  const rank = createMemo(() => new Map(standings().map((line, i) => [line.name, { line, i }])));

  /** Lays the whole event out on the clock: each round paired, its results a beat apart, a pause to read it. */
  function schedule(rounds: readonly SampleTable[][]) {
    let at = 600;
    rounds.forEach((round, r) => {
      later(at, () =>
        batch(() => {
          setRound(r + 1);
          setLanded(0);
        })
      );
      round.forEach((_, i) => later(at + (i + 1) * BEAT, () => setLanded(i + 1)));
      at += (round.length + 1) * BEAT + READ;
    });
    later(at, finish);
  }
  function finish() {
    setFinished(true);
    if (!still) {
      later(REST, play);
    }
  }
  function play() {
    stop();
    const next = newRun();
    batch(() => {
      setRun(next);
      setRound(0);
      setLanded(0);
      setFinished(false);
    });
    schedule(next.rounds);
  }
  onMount(() => {
    if (still) {
      batch(() => {
        setRound(ROUNDS);
        setLanded(run().rounds[ROUNDS - 1]?.length ?? 0);
        setFinished(true);
      });
    } else {
      play();
    }
  });
  onCleanup(stop);

  return (
    <section class='tm-sim' aria-label='Sample event'>
      <div class='tm-sim-bar'>
        <b>{finished() ? 'Final standings' : `Round ${Math.max(1, round())}`}</b>
        <span class='tm-sim-rounds' aria-hidden='true'>
          <For each={Array.from({ length: ROUNDS }, (_, i) => i)}>
            {i => <i classList={{ 'is-on': i < round() }} />}
          </For>
        </span>
        <span class='tm-grow' />
        <span class='tm-sim-tag'>Sample event, 16 players</span>
      </div>
      <div class='tm-sim-cols'>
        <div class='tm-sim-pairs'>
          <span class='tm-sim-label'>Pairings</span>
          <ol class='tm-sim-list'>
            <For each={tables()}>
              {(table, i) => (
                <li class='tm-sim-row'>
                  <span class='tm-sim-n'>{i() + 1}</span>
                  <span class='tm-sim-who'>
                    <TableLine table={table} done={i() < landed()} />
                  </span>
                </li>
              )}
            </For>
          </ol>
        </div>
        <div class='tm-sim-stand'>
          <span class='tm-sim-label'>Standings</span>
          {/* Rows stay in seat order and slide to their rank; a screen reader gets the top eight in rank order. */}
          <ol class='tm-sim-list' aria-hidden='true'>
            <For each={run().players}>{name => <StandingRow at={rank().get(name)} name={name} />}</For>
          </ol>
          <ol class='sr-only'>
            <For each={top()}>{line => <li>{`${line.name}, ${line.wins}-${line.losses}-${line.ties}`}</li>}</For>
          </ol>
        </div>
      </div>
    </section>
  );
}
