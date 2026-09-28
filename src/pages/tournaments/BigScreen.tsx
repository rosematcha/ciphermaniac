/**
 * The projector view (`/t/:code?screen=1`): the current round's pairings in
 * large type, scrolling on their own when they do not fit, with the clock and
 * a QR code to the event page. The site's chrome is hidden while it is up.
 */

import { createMemo, For, onCleanup, onMount, Show } from 'solid-js';
import type { Pod } from '../../../shared/tournament/types';
import type { TournamentView } from '../../../shared/tournament/view';
import { currentRound, namesById, recordsBefore, roundLabel } from '../../lib/tournament/present';
import { Clock } from './Clock';
import { QrCode } from './QrCode';

const STEP_MS = 40;
const PAUSE_MS = 4000;

/** Scrolls `el` down a pixel at a time, pausing at each end, while it overflows. */
function autoScroll(el: HTMLElement): () => void {
  let pausedUntil = Date.now() + PAUSE_MS;
  const timer = setInterval(() => {
    if (Date.now() < pausedUntil || el.scrollHeight <= el.clientHeight) {
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

function ScreenPairings(props: { view: TournamentView; pod: Pod }) {
  const names = createMemo(() => namesById(props.view.tournament));
  const round = () => currentRound(props.pod);
  const records = () => (round() ? recordsBefore(props.pod, round()!) : new Map<string, string>());
  const matches = () => round()?.matches ?? [];
  return (
    <ol class='tm-screen-list'>
      <For each={matches()}>
        {match => (
          <li>
            <span class='num tm-screen-table'>{match.table || '—'}</span>
            <span class='tm-screen-name'>
              {names().get(match.p1)} <span class='muted num'>{records().get(match.p1)}</span>
            </span>
            <span class='tm-screen-name'>
              <Show
                when={match.p2}
                fallback={<span class='muted'>{match.outcome === 'bye' ? 'Bye' : 'Missed round'}</span>}
              >
                {p2 => (
                  <>
                    {names().get(p2())} <span class='muted num'>{records().get(p2())}</span>
                  </>
                )}
              </Show>
            </span>
          </li>
        )}
      </For>
    </ol>
  );
}

export function BigScreen(props: { view: TournamentView }) {
  let scroller: HTMLDivElement | undefined;
  const url = () => `${location.origin}/t/${props.view.code}`;
  onMount(() => {
    document.body.classList.add('tm-screen-mode');
    const stop = scroller ? autoScroll(scroller) : () => undefined;
    onCleanup(() => {
      stop();
      document.body.classList.remove('tm-screen-mode');
    });
  });
  return (
    <div class='tm-screen'>
      <div class='tm-screen-main' ref={scroller}>
        <For each={props.view.tournament.pods}>
          {pod => (
            <section>
              <h2 class='tm-screen-round'>
                {props.view.tournament.info.name}
                <Show when={currentRound(pod)}>{round => <span class='muted'> · {roundLabel(round())}</span>}</Show>
              </h2>
              <ScreenPairings view={props.view} pod={pod} />
            </section>
          )}
        </For>
      </div>
      <aside class='tm-screen-side'>
        <Show when={currentRound(props.view.tournament.pods[0])}>
          {round => <Clock round={round()} class='tm-screen-clock' />}
        </Show>
        <QrCode text={url()} size={220} label='Event page QR code' />
        <p class='tm-screen-url'>{url().replace(/^https?:\/\//, '')}</p>
      </aside>
    </div>
  );
}
