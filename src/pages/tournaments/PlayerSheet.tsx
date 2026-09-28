/**
 * One player's event: record, tiebreakers and every match, opened from any
 * name on the public page. It is also where a player marks themselves, so
 * the page can lead with their table from then on.
 */

import { For, onCleanup, onMount, Show } from 'solid-js';
import { percentLabel, recordLabel, type Standing } from '../../../shared/tournament/standings';
import type { Pod } from '../../../shared/tournament/types';
import { matchHistory } from '../../lib/tournament/present';
import { DeckIcons } from './DeckIcons';

export function PlayerSheet(props: {
  playerId: string;
  pod: Pod;
  standing: Standing | undefined;
  names: Map<string, string>;
  decks: Record<string, string>;
  isMe: boolean;
  onMe: (id: string | null) => void;
  onClose: () => void;
  onPlayer: (id: string) => void;
}) {
  const history = () => matchHistory(props.pod, props.playerId);
  // Focus goes into the sheet and back to what opened it; Escape closes it.
  const opener = document.activeElement as HTMLElement | null;
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      props.onClose();
    }
  };
  onMount(() => document.addEventListener('keydown', onKey));
  onCleanup(() => {
    document.removeEventListener('keydown', onKey);
    opener?.focus();
  });
  return (
    <>
      <div class='tm-scrim' aria-hidden='true' onClick={() => props.onClose()} />
      <div class='tm-sheet' role='dialog' aria-modal='true' aria-labelledby='tm-sheet-title'>
        <div class='tm-sheet-head'>
          <h2 id='tm-sheet-title'>
            <DeckIcons label={props.decks[props.playerId]} size={22} />
            {props.names.get(props.playerId)}
          </h2>
          <button
            type='button'
            class='btn btn-ghost'
            ref={el => queueMicrotask(() => el.focus())}
            onClick={() => props.onClose()}
          >
            Close
          </button>
        </div>
        <Show when={props.decks[props.playerId]}>{label => <p class='muted'>{label()}</p>}</Show>
        <Show when={props.standing}>
          {row => (
            <dl class='stat-band'>
              <div class='stat-band-item'>
                <dt>Record</dt>
                <dd class='num'>{recordLabel(row().record)}</dd>
              </div>
              <div class='stat-band-item'>
                <dt>Points</dt>
                <dd class='num'>{row().points}</dd>
              </div>
              <div class='stat-band-item'>
                <dt>OWP</dt>
                <dd class='num'>{percentLabel(row().owp)}</dd>
              </div>
              <div class='stat-band-item'>
                <dt>OOWP</dt>
                <dd class='num'>{percentLabel(row().oowp)}</dd>
              </div>
            </dl>
          )}
        </Show>
        <ol class='tm-history'>
          <For each={history()}>
            {row => (
              <li>
                <span class='tm-mark' classList={{ 'is-win': row.mark === 'W' }}>
                  {row.mark || '·'}
                </span>
                <span class='muted num'>R{row.round}</span>
                <Show
                  when={row.opponent}
                  fallback={<span class='muted'>{row.outcome === 'bye' ? 'Bye' : 'Missed round'}</span>}
                >
                  {opponent => (
                    <button type='button' class='tm-seat-link' onClick={() => props.onPlayer(opponent())}>
                      <DeckIcons label={props.decks[opponent()]} />
                      <span class='tm-name'>{props.names.get(opponent())}</span>
                    </button>
                  )}
                </Show>
              </li>
            )}
          </For>
        </ol>
        <div class='tm-actions'>
          <button
            type='button'
            class={props.isMe ? 'btn btn-ghost' : 'btn btn-primary'}
            onClick={() => props.onMe(props.isMe ? null : props.playerId)}
          >
            {props.isMe ? 'This isn’t me' : 'This is me'}
          </button>
        </div>
      </div>
    </>
  );
}
