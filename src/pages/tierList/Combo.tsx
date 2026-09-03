/**
 * Typeahead used by the card picker and both custom-archetype pickers.
 *
 * Keyboard first: Down opens and walks the list, Enter takes the active
 * option, Escape closes without changing anything. The list is only ever
 * rebuilt from the ranking function, so mouse and keyboard cannot disagree
 * about what is selected.
 *
 * Never pre-filled — the box is for searching, not for displaying state, which
 * matches `SearchInput` and `PokemonPicker` elsewhere in the app.
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

  const take = (index: number): void => {
    const item = results()[index];
    if (!item) {
      return;
    }
    setOpen(false);
    setQuery('');
    props.onPick(item);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    const count = results().length;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open()) {
        setOpen(true);
        setActive(0);
        return;
      }
      setActive(i => (count ? (i + (event.key === 'ArrowDown' ? 1 : count - 1)) % count : 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      take(active());
    } else if (event.key === 'Escape') {
      event.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <div class='tl-combo' style={props.width ? { width: props.width } : undefined}>
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
        value={query()}
        onInput={e => {
          setQuery(e.currentTarget.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        // Delayed so a click on a result lands before the list unmounts.
        onBlur={() => setTimeout(() => setOpen(false), 150)}
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
