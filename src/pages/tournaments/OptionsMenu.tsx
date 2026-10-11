import { createEffect, createMemo, createSignal, createUniqueId, type JSX, onCleanup, Show } from 'solid-js';

function menuEvents(root: () => HTMLElement | undefined, close: () => void, place: () => void) {
  const outside = (event: PointerEvent) => {
    if (event.target instanceof Node && !root()?.contains(event.target)) {
      close();
    }
  };
  document.addEventListener('pointerdown', outside);
  window.addEventListener('scroll', place, { capture: true, passive: true });
  window.addEventListener('resize', close);
  onCleanup(() => {
    document.removeEventListener('pointerdown', outside);
    window.removeEventListener('scroll', place, { capture: true });
    window.removeEventListener('resize', close);
  });
}

export function OptionsMenu(props: {
  name: string;
  staff?: boolean;
  closeOnSelect?: boolean;
  busy?: boolean;
  children: JSX.Element;
}) {
  const id = createUniqueId();
  const [at, setAt] = createSignal<{ top: number; left: number } | null>(null);
  const open = createMemo(() => at() !== null);
  let root: HTMLSpanElement | undefined;
  let button: HTMLButtonElement | undefined;
  let menu: HTMLSpanElement | undefined;
  const close = () => setAt(null);
  const place = () => {
    const rect = button?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    const width = menu?.offsetWidth ?? 240;
    const height = menu?.offsetHeight ?? 144;
    const viewport = document.documentElement.getBoundingClientRect().width;
    const top = rect.bottom + height + 8 > innerHeight ? Math.max(8, rect.top - height - 4) : rect.bottom + 4;
    setAt({ top, left: Math.max(8, Math.min(rect.right - width, viewport - width - 8)) });
  };
  createEffect(() => {
    if (props.busy) {
      close();
    }
  });
  createEffect(() => {
    if (!open()) {
      return;
    }
    menuEvents(() => root, close, place);
    const observer = new ResizeObserver(place);
    if (menu) {
      observer.observe(menu);
    }
    onCleanup(() => {
      observer.disconnect();
    });
  });
  const mountMenu = (element: HTMLSpanElement) => {
    menu = element;
    queueMicrotask(() => {
      place();
      element.querySelector<HTMLButtonElement>('button')?.focus();
    });
  };
  return (
    <span
      ref={root}
      class='tm-more'
      classList={{ 'tm-staff-more': props.staff }}
      onClick={event => {
        event.stopPropagation();
        if (props.closeOnSelect && (event.target as Element).closest('.tm-menu-item')) {
          close();
        }
      }}
      onKeyDown={event => {
        if (event.key !== 'Escape') {
          return;
        }
        close();
        button?.focus();
      }}
    >
      <button
        ref={button}
        type='button'
        class='btn btn-ghost tm-small'
        aria-label={`More for ${props.name}`}
        aria-expanded={at() !== null}
        aria-controls={at() ? id : undefined}
        disabled={props.busy}
        onClick={() => {
          if (open()) {
            close();
          } else {
            place();
          }
        }}
      >
        ...
      </button>
      <Show when={at()}>
        {position => (
          <span
            ref={mountMenu}
            id={id}
            class='tm-menu tm-menu-fixed'
            classList={{ 'tm-staff-options': props.staff, 'tm-result-options': !props.staff }}
            role='group'
            aria-label={`More for ${props.name}`}
            style={{ top: `${String(position().top)}px`, left: `${String(position().left)}px` }}
          >
            {props.children}
          </span>
        )}
      </Show>
    </span>
  );
}
