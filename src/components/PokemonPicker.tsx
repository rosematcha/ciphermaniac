import { createMemo, createSignal, For, Show } from 'solid-js';
import SPRITE_SLUGS from '../data/pokemon-sprites.json';
import { spriteUrl } from '../lib/labelmaker/renderLabel';

const SLUGS = SPRITE_SLUGS as string[];
const MAX_RESULTS = 12;

/** `raging-bolt` → `Raging Bolt`. Slugs are the only name source we have. */
export function prettySlugName(slug: string): string {
  return slug
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

interface PokemonPickerProps {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  /** Show a clear button once something is picked. */
  clearable?: boolean;
  /** Distinguishes the listbox ids when several pickers share a page. */
  id: string;
}

/**
 * Type-to-search Pokémon sprite picker. A combobox rather than a <select>:
 * the list is ~1000 entries, and the sprite thumbnail is the point — it's how
 * you tell Deoxys' four forms apart.
 */
export function PokemonPicker(props: PokemonPickerProps) {
  const [query, setQuery] = createSignal('');
  const [open, setOpen] = createSignal(false);
  const [activeIndex, setActiveIndex] = createSignal(0);

  const results = createMemo(() => {
    const q = query().toLowerCase().trim();
    if (!q) {
      return [];
    }
    // Prefix matches first — typing "char" should surface Charmander before
    // Wartortle-Mega-Charizard-style substring hits.
    const prefix: string[] = [];
    const rest: string[] = [];
    for (const slug of SLUGS) {
      if (slug.startsWith(q)) {
        prefix.push(slug);
      } else if (slug.includes(q)) {
        rest.push(slug);
      }
      if (prefix.length >= MAX_RESULTS) {
        break;
      }
    }
    return [...prefix, ...rest].slice(0, MAX_RESULTS);
  });

  const listboxId = () => `pkm-listbox-${props.id}`;
  const optionId = (i: number) => `pkm-opt-${props.id}-${i}`;

  function commit(slug: string) {
    props.onChange(slug);
    setQuery('');
    setOpen(false);
    setActiveIndex(0);
  }

  function onKeyDown(e: KeyboardEvent) {
    const list = results();
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (list.length === 0) {
        return;
      }
      e.preventDefault();
      setOpen(true);
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex(i => (i + step + list.length) % list.length);
      return;
    }
    if (e.key === 'Enter') {
      const pick = list[activeIndex()];
      if (open() && pick) {
        e.preventDefault();
        commit(pick);
      }
    }
  }

  return (
    <div class='lm-field lm-picker'>
      <label for={`pkm-input-${props.id}`}>{props.label}</label>
      <div class='lm-picker-row'>
        <Show when={props.value}>
          <img class='lm-picker-icon' src={spriteUrl(props.value!)} alt='' />
        </Show>
        <input
          id={`pkm-input-${props.id}`}
          type='text'
          role='combobox'
          autocomplete='off'
          aria-expanded={open() && results().length > 0 ? 'true' : 'false'}
          aria-controls={listboxId()}
          aria-activedescendant={open() && results().length > 0 ? optionId(activeIndex()) : undefined}
          placeholder={props.value ? prettySlugName(props.value) : 'Search Pokémon…'}
          value={query()}
          onInput={e => {
            setQuery(e.currentTarget.value);
            setActiveIndex(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          // Delayed so a click on a result lands before the list unmounts.
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKeyDown}
        />
        <Show when={props.clearable && props.value}>
          <button type='button' class='lm-picker-clear' onClick={() => props.onChange(null)} aria-label='Remove'>
            ×
          </button>
        </Show>
      </div>
      <Show when={open() && results().length > 0}>
        <ul class='lm-picker-results' id={listboxId()} role='listbox' aria-label={props.label}>
          <For each={results()}>
            {(slug, i) => (
              <li
                id={optionId(i())}
                role='option'
                aria-selected={i() === activeIndex() ? 'true' : 'false'}
                class={i() === activeIndex() ? 'active' : ''}
                // mousedown, not click: blur fires first and would close the list.
                onMouseDown={e => {
                  e.preventDefault();
                  commit(slug);
                }}
                onMouseEnter={() => setActiveIndex(i())}
              >
                <img src={spriteUrl(slug)} alt='' loading='lazy' />
                {prettySlugName(slug)}
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}
