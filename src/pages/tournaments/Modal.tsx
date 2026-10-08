import { createEffect, type JSX } from 'solid-js';

/**
 * A native modal dialog, shown while `open`: the page behind it is inert,
 * focus moves in and comes back, and Escape closes it through `onClose`.
 */
export function Modal(props: {
  open: boolean;
  title: string;
  class?: string;
  onClose: () => void;
  children: JSX.Element;
}) {
  let dialog: HTMLDialogElement | undefined;
  createEffect(() => {
    if (props.open && !dialog?.open) {
      dialog?.showModal();
    } else if (!props.open && dialog?.open) {
      dialog.close();
    }
  });
  return (
    <dialog
      ref={el => (dialog = el)}
      class={props.class ? `tm-modal ${props.class}` : 'tm-modal'}
      aria-label={props.title}
      onClose={() => props.onClose()}
    >
      <div class='tm-box-bar'>
        <h3>{props.title}</h3>
      </div>
      {props.children}
    </dialog>
  );
}
