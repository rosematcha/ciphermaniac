/**
 * A top cut drawn as a bracket (see lib/tournament/bracket.ts): one column
 * per round, each match joined to the two that feed it, and the match for
 * third under it. The public page, the console and the big screen offer it
 * beside the table of matches, which stays the default.
 *
 * Each round is a section under its own heading, and each match names its
 * table, so a screen reader walks it round by round. On a phone the columns
 * scroll sideways inside the box rather than shrinking the names. The pages
 * load it the first time the bracket is asked for.
 */

import { createMemo, For, Index, type JSX, Show } from 'solid-js';
import type { Pod, Tournament } from '../../../shared/tournament/types';
import type { PendingResult } from '../../../shared/tournament/view';
import {
  type Bracket,
  type BracketMatch,
  type BracketSeat,
  buildBracket,
  cutSeeds
} from '../../lib/tournament/bracket';
import '../../styles/pages/tournament-bracket.css';

interface BracketProps {
  bracket: Bracket;
  names: Map<string, string>;
  /** The viewer's own player ID, whose matches are marked. */
  me?: string | null;
  onPlayer?: (id: string) => void;
}

const MARK_WORDS: Record<string, string> = { W: 'Won', L: 'Lost' };

function Seat(props: BracketProps & { seat: BracketSeat }) {
  const name = (id: string) => props.names.get(id) ?? id;
  return (
    <div class='tm-bracket-seat' classList={{ 'is-win': props.seat.mark === 'W', 'is-out': props.seat.mark === 'L' }}>
      <span class='tm-bracket-seed num'>{props.seat.seed ?? ''}</span>
      <Show
        when={props.seat.id}
        fallback={
          <span class='tm-bracket-name muted'>
            <span aria-hidden='true'>—</span>
            <span class='sr-only'>To be decided</span>
          </span>
        }
      >
        {id => (
          <Show when={props.onPlayer} fallback={<span class='tm-bracket-name tm-name'>{name(id())}</span>}>
            {open => (
              <button type='button' class='tm-seat-link tm-bracket-name' onClick={() => open()(id())}>
                <span class='tm-name'>{name(id())}</span>
              </button>
            )}
          </Show>
        )}
      </Show>
      <Show when={props.seat.id !== null && props.seat.id === props.me}>
        <span class='tm-flag is-you'>You</span>
      </Show>
      <span class='tm-mark' classList={{ 'is-win': props.seat.mark === 'W' }}>
        <Show when={props.seat.mark}>{mark => <span aria-label={MARK_WORDS[mark()]}>{mark()}</span>}</Show>
      </span>
    </div>
  );
}

function MatchBox(props: BracketProps & { match: BracketMatch }) {
  const mine = () => props.me != null && (props.match.top.id === props.me || props.match.bottom.id === props.me);
  const where = () => (props.match.table ? `Table ${props.match.table}` : 'Not paired yet');
  return (
    <div
      class='tm-bracket-match'
      classList={{ 'is-me': mine(), 'is-playing': props.match.playing, 'is-unconfirmed': props.match.unconfirmed }}
      role='group'
      aria-label={where()}
    >
      <div class='tm-bracket-meta'>
        <span>{where()}</span>
        <Show when={props.match.playing}>
          <strong>Playing</strong>
        </Show>
        <Show when={props.match.unconfirmed}>
          <span>Not yet confirmed</span>
        </Show>
      </div>
      <Seat {...props} seat={props.match.top} />
      <Seat {...props} seat={props.match.bottom} />
    </div>
  );
}

/** A round's matches two by two, each pair joined to the match its winners meet in. */
function pairsOf(matches: readonly BracketMatch[]): BracketMatch[][] {
  const pairs: BracketMatch[][] = [];
  for (let i = 0; i < matches.length; i += 2) {
    pairs.push(matches.slice(i, i + 2));
  }
  return pairs;
}

function BracketView(props: BracketProps & { class?: string }) {
  return (
    <div class={`tm-bracket ${props.class ?? ''}`} tabindex='0' role='region' aria-label='Top cut bracket'>
      <div class='tm-bracket-cols'>
        <For each={props.bracket.rounds}>
          {(round, i) => (
            <section class='tm-bracket-col' classList={{ 'is-fed': i() > 0 }}>
              <h3 class='tm-bracket-head'>{round.label}</h3>
              <div class='tm-bracket-body'>
                <Index each={pairsOf(round.matches)}>
                  {pair => (
                    <div class='tm-bracket-pair' classList={{ 'is-two': pair().length === 2 }}>
                      <Index each={pair()}>
                        {match => (
                          <div class='tm-bracket-slot'>
                            <MatchBox {...props} match={match()} />
                          </div>
                        )}
                      </Index>
                    </div>
                  )}
                </Index>
              </div>
            </section>
          )}
        </For>
      </div>
      <Show when={props.bracket.third}>
        {third => (
          <section class='tm-bracket-third'>
            <h3 class='tm-bracket-head'>Third place</h3>
            <MatchBox {...props} match={third()} />
          </section>
        )}
      </Show>
    </div>
  );
}

/** The pod's top cut as a bracket, seeded from the Swiss rounds before it; the fallback for a cut it cannot draw. */
export function CutBracket(
  props: Omit<BracketProps, 'bracket'> & {
    tournament: Tournament;
    pod: Pod;
    pending: readonly PendingResult[];
    class?: string;
    /** Drawn instead when the cut's rounds do not make one bracket: the page's table. */
    fallback: JSX.Element;
  }
) {
  const bracket = createMemo(() => buildBracket(props.pod, cutSeeds(props.tournament, props.pod), props.pending));
  return (
    <Show when={bracket()} fallback={props.fallback}>
      {b => (
        <BracketView bracket={b()} names={props.names} me={props.me} onPlayer={props.onPlayer} class={props.class} />
      )}
    </Show>
  );
}
