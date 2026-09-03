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
 * @module pages/tierList/Combo
 */

import { createSignal, createUniqueId, For, type JSX, Show } from 'solid-js';
import { rankByQuery } from './model';

interface ComboProps<T> {
  /** Placeholder and accessible name; the box carries no visible label. */
  placeholder: string;
  options: readonly T[];
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

  const results = (): T[] => rankByQuery(props.options, query(), props.label, props.weight);
  const optionId = (i: number): string => `${listId}-${i}`;

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
