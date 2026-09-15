import { createEffect, createMemo, createResource, createSignal, For, on, onCleanup, onMount, Show } from 'solid-js';
import { fetchLocatorPlaces } from '../../lib/data/eventLocator';
import type { LocatorIndex } from '../../../shared/events/types';
import { resolved } from '../../lib/resource';
import type { LatLon } from '../../lib/events/geo';
import { dayHeading } from '../../lib/events/format';
import { geocode } from '../../lib/events/geocode';
import {
  buildSearchIndex,
  busiestNearby,
  fold,
  geocodedSuggestion,
  localMatches,
  mergeSuggestions,
  type PlaceSuggestion
} from '../../lib/events/search';
import { loadRecents, rememberRecent } from '../../lib/events/recents';

export interface PlaceSearchProps {
  /** The listing's index, which says where this run's place list lives. */
  index: LocatorIndex | null;
  near: LatLon | null;
  currentLabel: string;
  currentCountry: string | null;
  countries: ReadonlySet<string>;
  locating: boolean;
  locateError: string | null;
  onPick: (place: PlaceSuggestion) => void;
  onLocate: () => void;
}

type Option = { id: string; kind: 'locate' } | { id: string; kind: 'place'; place: PlaceSuggestion; recent: boolean };

interface Group {
  title: string | null;
  options: Option[];
}

interface GeocodeState {
  query: string;
  places: PlaceSuggestion[];
  failed: boolean;
}

const DEBOUNCE_MS = 220;
const LISTBOX_ID = 'el-search-options';

const placeOption = (place: PlaceSuggestion, recent = false): Option => ({
  id: `${recent ? 'recent-' : ''}${place.id}`,
  kind: 'place',
  place,
  recent
});

/** Wrap the first query word where it appears in a label. */
function Highlight(props: { text: string; query: string }) {
  const parts = createMemo(() => {
    const term = fold(props.query).split(' ')[0] ?? '';
    const folded = fold(props.text);
    const at = term ? folded.indexOf(term) : -1;
    // Folding can change length (ligatures, some accents); only highlight when it did not.
    if (at < 0 || folded.length !== props.text.length) {
      return null;
    }
    return [props.text.slice(0, at), props.text.slice(at, at + term.length), props.text.slice(at + term.length)];
  });
  return (
    <Show when={parts()} fallback={props.text}>
      {p => (
        <>
          {p()[0]}
          <mark>{p()[1]}</mark>
          {p()[2]}
        </>
      )}
    </Show>
  );
}

/**
 * Debounced, cancellable geocoding of the query. A newer query aborts the
 * older request, and only an answer for the current query is ever kept.
 */
function createGeocoder(query: () => string, near: () => LatLon | null) {
  const [state, setState] = createSignal<GeocodeState | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;

  async function run(q: string) {
    controller = new AbortController();
    const { signal } = controller;
    try {
      const found = await geocode(q, { signal, bias: near() ?? undefined });
      setState({ query: q, places: found.map(geocodedSuggestion), failed: false });
    } catch {
      if (!signal.aborted) {
        setState({ query: q, places: [], failed: true });
      }
    }
  }

  createEffect(
    on(query, q => {
      clearTimeout(timer);
      controller?.abort();
      if (q.length < 2) {
        setState(null);
        return;
      }
      timer = setTimeout(() => void run(q), DEBOUNCE_MS);
    })
  );
  onCleanup(() => {
    clearTimeout(timer);
    controller?.abort();
  });
  return state;
}

/**
 * Search box over the map: the listing's cities and stores answer as you
 * type, a geocoder fills in everything else. A combobox in the ARIA sense;
 * on phones it opens full screen.
 */
export function PlaceSearch(props: PlaceSearchProps) {
  let root!: HTMLDivElement;
  let input!: HTMLInputElement;
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal('');
  const [active, setActive] = createSignal(-1);
  const [recents, setRecents] = createSignal(loadRecents());
  // The place list is the biggest download on the page, so it waits until someone searches.
  const [wantPlaces, setWantPlaces] = createSignal(false);
  const [places] = createResource(() => wantPlaces() && props.index, fetchLocatorPlaces);
  const index = createMemo(() => {
    const loaded = resolved(places);
    return loaded ? buildSearchIndex(loaded) : null;
  });
  const trimmed = () => query().trim();

  const geo = createGeocoder(trimmed, () => props.near);

  const idleGroups = (): Group[] => {
    const groups: Group[] = [{ title: null, options: [{ id: 'opt-locate', kind: 'locate' }] }];
    if (recents().length) {
      groups.push({ title: 'Recent', options: recents().map(place => placeOption(place, true)) });
    }
    const loaded = index();
    const busiest = loaded && props.near ? busiestNearby(loaded, props.near, props.currentLabel) : [];
    if (busiest.length) {
      groups.push({ title: 'Busiest nearby', options: busiest.map(place => placeOption(place)) });
    }
    return groups;
  };

  const queryGroups = (q: string): Group[] => {
    const loaded = index();
    const local = loaded ? localMatches(loaded, q, props.near ?? { lat: 0, lon: 0 }) : { cities: [], venues: [] };
    const state = geo();
    const sections = mergeSuggestions({
      query: q,
      ...local,
      geocoded: state?.query === q ? state.places : [],
      countries: props.countries,
      currentCountry: props.currentCountry
    });
    return sections.map(section => ({ title: section.title, options: section.items.map(place => placeOption(place)) }));
  };

  const groups = createMemo(() => (trimmed() ? queryGroups(trimmed()) : idleGroups()));
  const options = createMemo(() => groups().flatMap(group => group.options));
  const status = createMemo(() => {
    const q = trimmed();
    const state = geo();
    if (!q) {
      return null;
    }
    if (q.length >= 2 && state?.query !== q) {
      return 'Searching…';
    }
    if (options().length) {
      return null;
    }
    return state?.failed ? 'Place search is unavailable. Towns and stores with events still work.' : 'No matches.';
  });

  // Keep the highlighted option on a real row as the list changes.
  createEffect(
    on(options, list => {
      setActive(trimmed() && list.length ? 0 : -1);
    })
  );

  const show = () => {
    setWantPlaces(true);
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    setActive(-1);
  };

  // Phones open the search full screen; the page underneath must not scroll with it.
  createEffect(() => document.documentElement.classList.toggle('el-search-lock', open()));
  onCleanup(() => document.documentElement.classList.remove('el-search-lock'));

  function choose(option: Option | undefined) {
    if (!option) {
      return;
    }
    if (option.kind === 'locate') {
      props.onLocate();
    } else {
      setRecents(rememberRecent(option.place));
      props.onPick(option.place);
    }
    setQuery('');
    close();
    input.blur();
  }

  const KEYS: Record<string, (e: KeyboardEvent) => void> = {
    ArrowDown: () => setActive(i => (options().length ? (i + 1) % options().length : -1)),
    ArrowUp: () => setActive(i => (options().length ? (i - 1 + options().length) % options().length : -1)),
    // Only a highlighted option: Enter in an empty box must not fire a location prompt.
    Enter: () => active() >= 0 && choose(options()[active()]),
    Escape: () => (query() ? setQuery('') : (close(), input.blur()))
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const action = KEYS[e.key];
    if (!action) {
      return;
    }
    e.preventDefault();
    show();
    action(e);
  };

  onMount(() => {
    const onOutside = (e: PointerEvent) => {
      if (open() && !root.contains(e.target as Node)) {
        close();
      }
    };
    document.addEventListener('pointerdown', onOutside);
    onCleanup(() => document.removeEventListener('pointerdown', onOutside));
  });

  const domId = (option: Option) => `${LISTBOX_ID}-${options().indexOf(option)}`;
  const activeId = () => (active() >= 0 ? `${LISTBOX_ID}-${active()}` : undefined);
  const optionIndex = (option: Option) => options().indexOf(option);

  const meta = (option: Option): { text: string; strong: boolean } | null => {
    if (option.kind !== 'place' || option.recent) {
      return null;
    }
    const { place } = option;
    if (place.kind === 'venue' && place.next) {
      return { text: `Next ${dayHeading(place.next)}`, strong: true };
    }
    if (place.kind === 'city' && place.count) {
      return { text: `${place.count} event${place.count === 1 ? '' : 's'}`, strong: true };
    }
    if (!props.countries.has(place.cc)) {
      return { text: 'None listed', strong: false };
    }
    return null;
  };

  return (
    <div class='el-search' classList={{ open: open() }} ref={root}>
      <div class='el-search-row'>
        <svg class='el-search-icon' viewBox='0 0 24 24' aria-hidden='true'>
          <circle cx='11' cy='11' r='7' />
          <path d='m20 20-3.5-3.5' />
        </svg>
        <input
          ref={input}
          class='el-search-input'
          type='search'
          value={query()}
          placeholder='Search a place, postcode, or store'
          aria-label='Search a place, postcode, or store'
          role='combobox'
          aria-autocomplete='list'
          aria-expanded={open()}
          aria-controls={LISTBOX_ID}
          aria-activedescendant={open() ? activeId() : undefined}
          autocomplete='off'
          spellcheck={false}
          onFocus={show}
          onInput={e => {
            setQuery(e.currentTarget.value);
            show();
          }}
          onKeyDown={onKeyDown}
        />
        <Show when={query()}>
          <button
            type='button'
            class='el-search-clear'
            aria-label='Clear search'
            onClick={() => {
              setQuery('');
              input.focus();
            }}
          >
            ×
          </button>
        </Show>
        <button
          type='button'
          class='el-search-cancel'
          onClick={() => {
            setQuery('');
            close();
          }}
        >
          Cancel
        </button>
      </div>
      <div class='el-search-panel' hidden={!open()}>
        <div class='el-search-list' id={LISTBOX_ID} role='listbox' aria-label='Places'>
          <For each={groups()}>
            {group => (
              <div role='group' aria-label={group.title ?? 'Your location'}>
                <Show when={group.title}>
                  <div class='el-search-title' aria-hidden='true'>
                    {group.title}
                  </div>
                </Show>
                <For each={group.options}>
                  {option => (
                    <div
                      id={domId(option)}
                      role='option'
                      class='el-option'
                      classList={{ locate: option.kind === 'locate' }}
                      aria-selected={activeId() === domId(option)}
                      onPointerDown={e => e.preventDefault()}
                      onPointerMove={() => setActive(optionIndex(option))}
                      onClick={() => choose(option)}
                    >
                      <OptionBody
                        option={option}
                        query={trimmed()}
                        meta={meta(option)}
                        locating={props.locating}
                        locateError={props.locateError}
                      />
                    </div>
                  )}
                </For>
              </div>
            )}
          </For>
        </div>
        <Show when={status()}>
          <p class='el-search-note' role='status'>
            {status()}
          </p>
        </Show>
      </div>
    </div>
  );
}

function OptionBody(props: {
  option: Option;
  query: string;
  meta: { text: string; strong: boolean } | null;
  locating: boolean;
  locateError: string | null;
}) {
  return (
    <Show
      when={props.option.kind === 'place' ? props.option : null}
      fallback={
        <>
          <svg class='el-option-icon' viewBox='0 0 24 24' aria-hidden='true'>
            <circle cx='12' cy='12' r='3' />
            <path d='M12 2v4M12 18v4M2 12h4M18 12h4' />
            <circle cx='12' cy='12' r='8' />
          </svg>
          <span class='el-option-main'>
            <span class='el-option-label'>{props.locating ? 'Finding you…' : 'Use my location'}</span>
            <Show when={props.locateError}>
              <span class='el-option-detail'>{props.locateError}</span>
            </Show>
          </span>
          <span />
        </>
      }
    >
      {option => (
        <>
          <svg class='el-option-icon' viewBox='0 0 24 24' aria-hidden='true'>
            <Show
              when={option().place.kind === 'venue'}
              fallback={
                <path d='M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z M12 11.5a2.5 2.5 0 1 0 0-5a2.5 2.5 0 0 0 0 5z' />
              }
            >
              <path d='M4 10h16v10H4zM3 10l2-6h14l2 6M10 20v-5h4v5' />
            </Show>
          </svg>
          <span class='el-option-main'>
            <span class='el-option-label'>
              <Highlight text={option().place.label} query={props.query} />
            </span>
            <Show when={option().place.detail}>
              <span class='el-option-detail'>{option().place.detail}</span>
            </Show>
          </span>
          <span class='el-option-meta' classList={{ strong: props.meta?.strong ?? false }}>
            {props.meta?.text ?? ''}
          </span>
        </>
      )}
    </Show>
  );
}
