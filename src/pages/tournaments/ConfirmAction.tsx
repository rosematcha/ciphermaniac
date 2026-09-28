import { createSignal, Show } from 'solid-js';

/**
 * A button that takes a second press before it acts, asked in place: the
 * button becomes the question and its answer, and Escape or Keep backs out.
 * For anything that cannot be taken back from the same screen.
 */
export function ConfirmAction(props: {
  label: string;
  /** The question the second press answers, e.g. "Remove Ada?". */
  question: string;
  confirmLabel?: string;
  class?: string;
  disabled?: boolean;
  onConfirm: () => void;
}) {
  const [asking, setAsking] = createSignal(false);
  return (
    <Show
      when={asking()}
      fallback={
        <button
          type='button'
          class={props.class ?? 'btn btn-ghost tm-small'}
          disabled={props.disabled}
          onClick={() => setAsking(true)}
        >
          {props.label}
        </button>
      }
    >
      <span
        class='tm-row-actions tm-confirm'
        role='group'
        aria-label={props.question}
        onKeyDown={e => {
          if (e.key === 'Escape') {
            setAsking(false);
          }
        }}
      >
        <span class='tm-confirm-label'>{props.question}</span>
        <button
          type='button'
          class='btn btn-primary tm-small'
          ref={el => queueMicrotask(() => el.focus())}
          onClick={() => {
            setAsking(false);
            props.onConfirm();
          }}
        >
          {props.confirmLabel ?? props.label}
        </button>
        <button type='button' class='btn btn-ghost tm-small' onClick={() => setAsking(false)}>
          Keep
        </button>
      </span>
    </Show>
  );
}
