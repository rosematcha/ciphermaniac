import { createSignal, type JSX, Show } from 'solid-js';

/**
 * A button that takes a second press before it acts, asked in place: the
 * button becomes the question and its answer, and Escape or Keep backs out,
 * handing focus back to the button. For anything that cannot be taken back
 * from the same screen. A destructive answer (`danger`) is drawn in the
 * negative hue rather than as the page's primary.
 */
export function ConfirmAction(props: {
  label: string;
  /** The question the second press answers, e.g. "Remove Ada?". */
  question: string;
  confirmLabel?: string;
  class?: string;
  disabled?: boolean;
  danger?: boolean;
  /** Anything the question needs besides its answer, such as a Keep reported results box. */
  extra?: JSX.Element;
  onConfirm: () => void;
}) {
  const [asking, setAsking] = createSignal(false);
  let trigger: HTMLButtonElement | undefined;
  const back = () => {
    setAsking(false);
    queueMicrotask(() => trigger?.focus());
  };
  return (
    <Show
      when={asking()}
      fallback={
        <button
          ref={el => (trigger = el)}
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
            back();
          }
        }}
      >
        <span class='tm-confirm-label'>{props.question}</span>
        {props.extra}
        <button
          type='button'
          class={props.danger ? 'btn btn-secondary tm-small tm-danger' : 'btn btn-primary tm-small'}
          ref={el => queueMicrotask(() => el.focus())}
          onClick={() => {
            setAsking(false);
            props.onConfirm();
          }}
        >
          {props.confirmLabel ?? props.label}
        </button>
        <button type='button' class='btn btn-ghost tm-small' onClick={back}>
          Keep
        </button>
      </span>
    </Show>
  );
}
