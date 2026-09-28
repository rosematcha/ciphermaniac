import { type JSX, Show } from 'solid-js';

/** A labelled form control with an optional error line, the house form row. */
export function Field(props: { id: string; label: string; error?: string | undefined; children: JSX.Element }) {
  return (
    <div class='tm-field'>
      <label class='tm-label' for={props.id}>
        {props.label}
      </label>
      {props.children}
      <Show when={props.error}>
        <span class='tm-error' id={`${props.id}-error`}>
          {props.error}
        </span>
      </Show>
    </div>
  );
}

/** The one line a failed request leaves, where the action was. */
export function ErrorLine(props: { message: string | null | undefined }) {
  return (
    <Show when={props.message}>
      <p class='tm-error' role='alert'>
        {props.message}
      </p>
    </Show>
  );
}
