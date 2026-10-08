/**
 * Result entry where the room's rows are too narrow for their own controls
 * (900px and under, see RoundPanel): a table is pressed, and this sheet rises
 * with its players and every result it can take as full-size buttons. A
 * press records at once, since opening the sheet was the first step; a lone
 * report is offered first, as Accept is in a wide row. Focus starts on the
 * sheet, stays in it, and goes back to what opened it.
 */

import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import type { Match, Outcome, Round } from '../../../shared/tournament/types';
import { RESULT_WORDS } from '../../lib/tournament/present';
import { DeckIcons } from './DeckIcons';

/** Table-level results, besides either player winning; an elimination match has neither. */
const EVEN: { outcome: Outcome; label: string }[] = [
  { outcome: 'tie', label: 'Tie' },
  { outcome: 'double-loss', label: 'Double loss' }
];

export function ResultSheet(props: {
  match: Match;
  round: Round;
  names: Map<string, string>;
  decks: Record<string, string>;
  records: Map<string, string>;
  /** The result that stands, or 'pending' while the table plays. */
  outcome: Outcome;
  /** What the players reported, as staff read it, while the table plays. */
  report: { label: string; detail: string } | null;
  /** A lone report staff can take as it is. */
  lone: Outcome | null;
  onPick: (outcome: Outcome) => void;
  onClose: () => void;
}) {
  const [ready, setReady] = createSignal(false);
  let sheet: HTMLDivElement | undefined;
  const name = (id: string | null) => (id ? (props.names.get(id) ?? id) : '');
  const first = (id: string | null) => name(id).split(' ')[0] ?? '';
  const winners = (): { outcome: Outcome; label: string }[] => [
    { outcome: 'p1', label: `${first(props.match.p1)} wins` },
    { outcome: 'p2', label: `${first(props.match.p2)} wins` }
  ];
  const choices = () => [...winners(), ...(props.round.kind === 'elimination' ? [] : EVEN)];
  const standing = () =>
    props.outcome === 'pending' ? (props.report?.label ?? 'In progress') : RESULT_WORDS[props.outcome];

  onMount(() => {
    // Back to whatever opened it once it closes; the page behind holds still meanwhile.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = document.documentElement;
    const { overflow } = root.style;
    root.style.overflow = 'hidden';
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        props.onClose();
      } else if (event.key === 'Tab') {
        keepFocus(event);
      }
    };
    document.addEventListener('keydown', key, true);
    onCleanup(() => {
      document.removeEventListener('keydown', key, true);
      root.style.overflow = overflow;
      opener?.focus();
    });
    // The sheet itself takes focus, not its first button: a stray Enter must not record a result.
    sheet?.focus();
    requestAnimationFrame(() => setReady(true));
  });

  /** Tab stays inside the sheet while it is open. */
  function keepFocus(event: KeyboardEvent) {
    const buttons = [...(sheet?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    const first = buttons[0];
    const last = buttons.at(-1);
    const at = document.activeElement;
    if (event.shiftKey && (at === first || at === sheet)) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && at === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  const seat = (id: string | null, seatOutcome: Outcome) => (
    <Show when={id}>
      {playerId => (
        <p
          class='tm-sheet-seat'
          classList={{ 'is-lost': props.outcome !== 'pending' && props.outcome !== seatOutcome }}
        >
          <DeckIcons label={props.decks[playerId()]} />
          <span class='tm-name'>{name(playerId())}</span>
          <span class='muted tm-record'>{props.records.get(playerId()) ?? ''}</span>
        </p>
      )}
    </Show>
  );

  return (
    <>
      <div class='tm-result-scrim' onClick={() => props.onClose()} />
      <div
        ref={sheet}
        class='tm-result-sheet'
        classList={{ 'is-in': ready() }}
        role='dialog'
        aria-modal='true'
        tabIndex={-1}
        aria-label={`Result, table ${props.match.table}`}
      >
        <div class='tm-sheet-top'>
          <strong>Table {props.match.table}</strong>
          <span
            class='tm-result-label'
            classList={{ 'is-open': props.outcome === 'pending' }}
            title={props.report?.detail}
          >
            {standing()}
          </span>
        </div>
        <div class='tm-sheet-seats'>
          {seat(props.match.p1, 'p1')}
          {seat(props.match.p2, 'p2')}
        </div>
        <Show when={props.lone}>
          {lone => (
            <button type='button' class='btn btn-primary tm-sheet-accept' onClick={() => props.onPick(lone())}>
              Accept {RESULT_WORDS[lone()]}
            </button>
          )}
        </Show>
        <div class='tm-sheet-choices'>
          <For each={choices()}>
            {choice => (
              <button
                type='button'
                class='btn btn-secondary'
                aria-pressed={props.outcome === choice.outcome}
                onClick={() => props.onPick(choice.outcome)}
              >
                {choice.label}
              </button>
            )}
          </For>
        </div>
        <Show when={props.outcome !== 'pending'}>
          <button type='button' class='btn btn-ghost tm-sheet-clear' onClick={() => props.onPick('pending')}>
            Clear result
          </button>
        </Show>
        <button type='button' class='btn btn-ghost tm-sheet-close' onClick={() => props.onClose()}>
          Cancel
        </button>
      </div>
    </>
  );
}
