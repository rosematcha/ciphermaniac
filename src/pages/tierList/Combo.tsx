/**
 * Typeahead used by the card picker and both custom-archetype pickers.
 *
 * Keyboard first: Down opens and walks the list, Enter takes the active
 * option, Escape closes without changing anything. The list is only ever
 * rebuilt from the ranking function, so mouse and keyboard cannot disagree
 * about what is selected.
 *
 * Two shapes. Given `selected`, the box stands for that item while idle — its
 * name is the value and `adorn` draws beside it — and becomes a search the
 * moment it is focused, emptying so the browse list is the first thing seen;
 * closing puts the name back. That makes one control out of "what is chosen"
 * and "change it", the way a select is. Without `selected` the box only
 * searches and keeps what was typed, like `SearchInput` and `PokemonPicker`.
 *
 * Browsing and searching are separate lists. With nothing typed the box offers
 * `browse` in full and lets the user scroll it; once there is a query it ranks
 * the whole of `options` and shows the best few. A caller with a long tail can
 * therefore keep the tail findable without making it the first thing anyone
 * sees.
 * @module pages/tierList/Combo
 */

import { createEffect, createMemo, createSignal, createUniqueId, For, type JSX, Show } from 'solid-js';
import { rankByQuery, SUGGESTION_LIMIT } from './model';

interface ComboProps<T> {
  /** Placeholder and accessible name; the box carries no visible label. */
  placeholder: string;
  options: readonly T[];
  /**
   * What the list offers before anything is typed, in the order to show it.
   * Defaults to the head of `options`, which is right for a picker whose whole
   * catalogue is too long to scroll.
   */
  browse?: readonly T[];
  /** Display name, also what the query matches against. */
  label: (item: T) => string;
  /** Higher sorts first among equally-good matches. */
  weight?: (item: T) => number;
  /**
   * The item the box stands for while it is not being typed in. Shown as the
   * value, marked in the list, and the row the keyboard starts on.
   */
  selected?: T;
  /** Drawn inside the field beside the selected item's name, e.g. its art. */
  adorn?: (item: T) => JSX.Element;
  /** Row content beside the name, e.g. a thumbnail and a count. */
  children: (item: T, query: string) => JSX.Element;
  onPick: (item: T) => void;
  /** Width of the field; the list matches it. */
  width?: string;
}

/** Splits a name around the matched run so the match can be marked. */
export function splitMatch(name: string, query: string): [string, string, string] {
  const q = query.trim();
  const at = q ? name.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (at < 0) {
    return [name, '', ''];
  }
  return [name.slice(0, at), name.slice(at, at + q.length), name.slice(at + q.length)];
}

export function Combo<T>(props: ComboProps<T>): JSX.Element {
  const listId = createUniqueId();
  const [query, setQuery] = createSignal('');
  const [open, setOpen] = createSignal(false);
  const [active, setActive] = createSignal(0);

  // Memoised: with a browse list running to a hundred entries this is read
  // several times per render, and every read would otherwise re-rank.
  const results = createMemo<T[]>(() => {
    const q = query().trim();
    if (!q) {
      return [...(props.browse ?? props.options.slice(0, SUGGESTION_LIMIT))];
    }
    return rankByQuery(props.options, q, props.label, props.weight);
  });
  const optionId = (i: number): string => `${listId}-${i}`;
  const stands = (): boolean => props.selected !== undefined;
  /** The idle box shows what it stands for; an open one shows what is typed. */
  const shown = (): string => (open() || props.selected === undefined ? query() : props.label(props.selected));

  // A browsable list is taller than its own window, so walking it with the
  // arrow keys has to bring the active row along. `nearest` keeps a click-then-
  // arrow from jumping the list about.
  createEffect(() => {
    if (!open()) {
      return;
    }
    const row = document.getElementById(optionId(active()));
    row?.scrollIntoView({ block: 'nearest' });
  });

  /** Opening from idle lands on the current item, so Enter is a no-op rather than a surprise. */
  const openList = (): void => {
    setOpen(true);
    setActive(props.selected === undefined ? 0 : Math.max(0, results().indexOf(props.selected)));
  };

  /** A box that stands for something forgets the search on close; a plain one keeps it. */
  const close = (): void => {
    setOpen(false);
    if (stands()) {
      setQuery('');
    }
  };

  const take = (index: number): void => {
    const item = results()[index];
    if (!item) {
      return;
    }
    setOpen(false);
    setQuery('');
    props.onPick(item);
  };

  /**
   * A closed box still has focus after a pick or an Escape, and it is showing
   * a name. A keystroke then would edit that name. Empty it first, so the
   * character lands in a fresh search instead.
   */
  const startTyping = (event: KeyboardEvent): void => {
    if (!open() && stands() && (event.key.length === 1 || event.key === 'Backspace')) {
      setQuery('');
      setOpen(true);
    }
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    startTyping(event);
    const count = results().length;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open()) {
        openList();
        return;
      }
      setActive(i => (count ? (i + (event.key === 'ArrowDown' ? 1 : count - 1)) % count : 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      take(active());
    } else if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  };

  return (
    <div
      class='tl-combo'
      classList={{ 'tl-picker': stands() }}
      style={props.width ? { width: props.width } : undefined}
    >
      <Show when={props.selected}>{item => <span class='tl-combo-lead'>{props.adorn?.(item())}</span>}</Show>
      <input
        type='text'
        class='search'
        role='combobox'
        autocomplete='off'
        spellcheck={false}
        aria-expanded={open() ? 'true' : 'false'}
        aria-controls={listId}
        aria-autocomplete='list'
        aria-activedescendant={open() && results().length > 0 ? optionId(active()) : undefined}
        aria-label={props.placeholder}
        placeholder={props.placeholder}
        value={shown()}
        onInput={e => {
          setQuery(e.currentTarget.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={openList}
        // Delayed so a click on a result lands before the list unmounts.
        onBlur={() => setTimeout(close, 150)}
        onKeyDown={onKeyDown}
      />
      <Show when={open()}>
        <ul class='tl-list' id={listId} role='listbox'>
          <Show when={results().length > 0} fallback={<li class='none'>Nothing matches.</li>}>
            <For each={results()}>
              {(item, i) => (
                <li
                  role='option'
                  id={optionId(i())}
                  aria-selected={i() === active()}
                  classList={{ cur: item === props.selected }}
                  onMouseDown={e => {
                    e.preventDefault();
                    take(i());
                  }}
                >
                  {props.children(item, query())}
                </li>
              )}
            </For>
          </Show>
        </ul>
      </Show>
    </div>
  );
}
