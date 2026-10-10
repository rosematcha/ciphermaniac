import { createEffect, createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';

interface TabsProps<T extends string> {
  /** `locked`: why the tab cannot be opened yet, shown when it is pressed or hovered. */
  options: { value: T; label: string; locked?: string }[];
  selected: T;
  onSelect: (value: T) => void;
  ariaLabel?: string;
}

/**
 * Underline tabs — for big in-page section navigation.
 *
 * On narrow screens the strip scrolls horizontally. Edge-fade classes
 * (`fade-l` / `fade-r`) signal hidden tabs — without them, clipped tabs like
 * "Matchups" were simply undiscoverable on phones — and the active tab is
 * kept scrolled into view.
 */
export function Tabs<T extends string>(props: TabsProps<T>) {
  let nav: HTMLElement | undefined;

  function updateFades() {
    if (!nav) {
      return;
    }
    const maxScroll = nav.scrollWidth - nav.clientWidth;
    nav.classList.toggle('fade-l', maxScroll > 1 && nav.scrollLeft > 1);
    nav.classList.toggle('fade-r', maxScroll > 1 && nav.scrollLeft < maxScroll - 1);
  }

  onMount(() => {
    updateFades();
    nav?.addEventListener('scroll', updateFades, { passive: true });
    const ro = new ResizeObserver(updateFades);
    if (nav) {
      ro.observe(nav);
    }
    onCleanup(() => {
      nav?.removeEventListener('scroll', updateFades);
      ro.disconnect();
    });
  });

  createEffect(() => {
    if (!nav) {
      return;
    }
    const active = nav.querySelector<HTMLElement>(`[data-value="${props.selected}"]`);
    active?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
  });

  return (
    <nav ref={nav} class='tabs' role='tablist' aria-label={props.ariaLabel ?? 'Section'}>
      <For each={props.options}>
        {opt => (
          <Show
            when={opt.locked}
            fallback={
              <button
                type='button'
                role='tab'
                data-value={opt.value}
                class={props.selected === opt.value ? 'active' : ''}
                aria-selected={props.selected === opt.value ? 'true' : 'false'}
                onClick={() => props.onSelect(opt.value)}
              >
                {opt.label}
              </button>
            }
          >
            {hint => (
              <LockedTab hint={hint()} role='tab' value={opt.value}>
                {opt.label}
              </LockedTab>
            )}
          </Show>
        )}
      </For>
    </nav>
  );
}

/**
 * A tab that cannot be opened yet: dimmed, and pressing or hovering it says
 * why in the site's info bubble (see InfoTip). Pressing it again, or moving
 * focus away, closes the bubble.
 */
export function LockedTab(props: { hint: string; children: JSX.Element; role?: 'tab'; value?: string }) {
  const [open, setOpen] = createSignal(false);
  return (
    <span class='info-tip tab-locked' classList={{ open: open() }}>
      <button
        type='button'
        role={props.role}
        data-value={props.value}
        aria-disabled='true'
        aria-selected={props.role ? 'false' : undefined}
        aria-description={props.hint}
        onClick={() => setOpen(!open())}
        onBlur={() => setOpen(false)}
      >
        {props.children}
      </button>
      <span class='info-tip-bubble' role='tooltip'>
        {props.hint}
      </span>
    </span>
  );
}
