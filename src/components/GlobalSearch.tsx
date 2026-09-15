import { useNavigate } from '@solidjs/router';
import { createEffect, createMemo, createResource, createSignal, For, on, onCleanup, onMount, Show } from 'solid-js';
import { ArchetypeIcons } from './ArchetypeIcon';
import { BottomSheet } from './BottomSheet';
import { CardImage } from './CardImage';
import { Skeleton } from './Skeleton';
import {
  fetchArchetypes,
  fetchMaster,
  fetchPlayerIndexSlim,
  fetchTournamentsList,
  getArchetypeIconMap,
  resolveArchetypeIcons
} from '../lib/data';
import { debounced } from '../lib/debounce';
import {
  buildSearchIndex,
  createSearchLoader,
  type SearchEntry,
  type SearchHit,
  type SearchKind,
  searchTiered
} from '../lib/globalSearch';
import { prefetchRoute } from '../lib/prefetch';
import { latestValue } from '../lib/resource';
import { useTournament } from '../lib/tournamentContext';

const KIND_LABEL: Record<SearchKind, string> = {
  archetype: 'Archetypes',
  card: 'Cards',
  player: 'Players',
  tournament: 'Tournaments'
};

/** The prefetch key (see `prefetchRoute`) for each kind's destination. */
const KIND_ROUTE: Record<SearchKind, string> = {
  archetype: '/archetypes/:slug',
  card: '/cards/:set/:number',
  player: '/players/:id',
  tournament: '/'
};

const PHONE_QUERY = '(max-width: 640px)';

// One loader per session: indices fetched once stay cached across opens.
const loader = createSearchLoader({
  cards: scope => fetchMaster(scope).then(m => m.items),
  archetypes: fetchArchetypes,
  players: fetchPlayerIndexSlim,
  tournaments: fetchTournamentsList
});

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

function isSlashShortcut(e: KeyboardEvent): boolean {
  return e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.defaultPrevented && !isTypingTarget(e.target);
}

/** All of the box's state: lazy indices, ranked results, the active row. */
function createSearchState(onChosen: () => void) {
  const { tournament, setTournament } = useTournament();
  const navigate = useNavigate();
  const [query, setQuery] = createSignal('');
  const [open, setOpen] = createSignal(false);
  const [active, setActive] = createSignal(0);
  const [activated, setActivated] = createSignal(false);
  // Bumped when the box reopens after a failed load, so the resources retry.
  const [attempt, setAttempt] = createSignal(0);
  // eslint-disable-next-line solid/reactivity -- debounced reads `query` inside its own createEffect (a tracked scope); the analyzer can't see through the helper
  const settled = debounced(query, 120);

  // Nothing fetches until the box is first opened; cards and archetypes follow the scope.
  const scoped = () => (activated() ? { scope: tournament(), attempt: attempt() } : false);
  const global = () => (activated() ? attempt() + 1 : false);
  const [cards] = createResource(scoped, ({ scope }) => loader.cards(scope));
  const [archetypes] = createResource(scoped, ({ scope }) => loader.archetypes(scope));
  const [players] = createResource(global, () => loader.players());
  const [tournaments] = createResource(global, () => loader.tournaments());
  const sources = [cards, archetypes, players, tournaments];

  const index = createMemo(() =>
    buildSearchIndex({
      cards: latestValue(cards),
      archetypes: latestValue(archetypes),
      players: latestValue(players),
      tournaments: latestValue(tournaments)
    })
  );
  const results = createMemo(() => searchTiered(index(), settled()));
  const loading = () => sources.some(r => r.loading);
  const hasQuery = () => query().trim().length > 0;

  // A new query starts at the top; a late index load only clamps the row.
  createEffect(on(settled, () => setActive(0), { defer: true }));
  createEffect(() => {
    const count = results().hits.length;
    if (active() >= count) {
      setActive(Math.max(0, count - 1));
    }
  });

  function reset() {
    setQuery('');
    setOpen(false);
  }

  function choose(entry: SearchEntry) {
    // A scoped href carries the tournament itself; the tournament context
    // adopts it from the URL. Only the unscoped online meta needs setting.
    if (entry.kind === 'tournament' && entry.href === '/') {
      setTournament(entry.tournament);
    }
    navigate(entry.href);
    reset();
    onChosen();
  }

  function move(delta: number) {
    const count = results().hits.length;
    if (count > 0) {
      setActive(i => (i + delta + count) % count);
    }
  }

  const keyActions: Record<string, () => void> = {
    ArrowDown: () => move(1),
    ArrowUp: () => move(-1),
    Enter: () => {
      // Typed faster than the debounce: rank what is in the box right now.
      const current = settled() === query();
      const hit = current ? results().hits[active()] : searchTiered(index(), query()).hits[0];
      if (hit) {
        choose(hit.entry);
      }
    },
    Escape: reset
  };

  function onKeyDown(e: KeyboardEvent): boolean {
    const action = keyActions[e.key];
    if (!action) {
      return false;
    }
    e.preventDefault();
    if (e.key === 'Escape' && hasQuery()) {
      // First Escape clears; only an empty box lets the sheet close.
      e.stopPropagation();
    }
    action();
    return true;
  }

  let blurTimer: number | undefined;

  return {
    query,
    setQuery,
    open,
    setOpen,
    active,
    setActive,
    results,
    loading,
    hasQuery,
    choose,
    onKeyDown,
    activate: () => {
      window.clearTimeout(blurTimer);
      if (sources.some(r => r.error)) {
        setAttempt(n => n + 1);
      }
      setActivated(true);
    },
    // Late, so a mousedown on a row lands before the popover goes away.
    closeSoon: () => {
      blurTimer = window.setTimeout(() => setOpen(false), 120);
    }
  };
}

type SearchState = ReturnType<typeof createSearchState>;

function Leading(props: { entry: SearchEntry }) {
  const entry = () => props.entry;
  return (
    <span class='gsearch-lead' aria-hidden='true'>
      <Show when={entry().kind === 'archetype' && entry()}>
        {e => <ArchetypeIcons slugs={resolveArchetypeIcons(e(), getArchetypeIconMap())} size={20} />}
      </Show>
      <Show when={entry().kind === 'card' ? (entry() as Extract<SearchEntry, { kind: 'card' }>) : null}>
        {e => <CardImage set={e().set} number={e().number} size='xs' class='gsearch-thumb' alt='' />}
      </Show>
      <Show when={entry().kind === 'tournament' ? (entry() as Extract<SearchEntry, { kind: 'tournament' }>) : null}>
        {e => <span class='gsearch-date'>{e().date}</span>}
      </Show>
    </span>
  );
}

function ResultRow(props: { state: SearchState; hit: SearchHit; id: string; index: number }) {
  const selected = () => props.state.active() === props.index;
  return (
    <div
      id={props.id}
      role='option'
      aria-selected={selected() ? 'true' : 'false'}
      class='gsearch-row'
      classList={{ active: selected() }}
      onMouseDown={e => {
        e.preventDefault();
        props.state.choose(props.hit.entry);
      }}
      onMouseEnter={() => {
        props.state.setActive(props.index);
        prefetchRoute(KIND_ROUTE[props.hit.entry.kind]);
      }}
    >
      <Leading entry={props.hit.entry} />
      <span class='gsearch-label'>{props.hit.entry.label}</span>
      <span class='gsearch-sub'>{props.hit.entry.sublabel}</span>
    </div>
  );
}

function ResultList(props: { state: SearchState; prefix: string }) {
  const optionId = (i: number) => `${props.prefix}-opt-${i}`;
  const empty = () => !props.state.loading() && props.state.results().hits.length === 0;

  createEffect(() => {
    document.getElementById(optionId(props.state.active()))?.scrollIntoView({ block: 'nearest' });
  });

  return (
    <div id={`${props.prefix}-list`} class='gsearch-list' role='listbox' aria-label='Search results'>
      <For each={props.state.results().groups}>
        {group => (
          <div role='group' aria-labelledby={`${props.prefix}-${group.kind}`}>
            <div id={`${props.prefix}-${group.kind}`} class='gsearch-group' role='presentation'>
              {KIND_LABEL[group.kind]}
            </div>
            <For each={group.hits}>
              {hit => {
                const index = () => props.state.results().hits.indexOf(hit);
                return <ResultRow state={props.state} hit={hit} id={optionId(index())} index={index()} />;
              }}
            </For>
          </div>
        )}
      </For>
      <Show when={props.state.loading()}>
        <div class='gsearch-row gsearch-skeleton' aria-hidden='true'>
          <Skeleton width='60%' />
        </div>
      </Show>
      <Show when={empty()}>
        <div class='gsearch-empty'>No matches</div>
      </Show>
    </div>
  );
}

function SearchField(props: {
  state: SearchState;
  prefix: string;
  inSheet?: boolean;
  ref?: (el: HTMLInputElement) => void;
}) {
  const expanded = () => props.state.hasQuery() && (props.inSheet || props.state.open());
  const activeId = () =>
    expanded() && props.state.results().hits.length > 0 ? `${props.prefix}-opt-${props.state.active()}` : undefined;

  return (
    <div class='gsearch-field' classList={{ 'gsearch-field-sheet': props.inSheet }}>
      <input
        ref={props.ref}
        class='gsearch-input'
        type='search'
        role='combobox'
        placeholder='Search'
        aria-label='Search cards, archetypes, players, and tournaments'
        aria-autocomplete='list'
        aria-expanded={expanded() ? 'true' : 'false'}
        aria-controls={`${props.prefix}-list`}
        aria-activedescendant={activeId()}
        autocomplete='off'
        spellcheck={false}
        value={props.state.query()}
        onInput={e => {
          props.state.setQuery(e.currentTarget.value);
          props.state.setOpen(true);
        }}
        onFocus={() => {
          props.state.activate();
          props.state.setOpen(true);
        }}
        onBlur={() => props.state.closeSoon()}
        onKeyDown={e => {
          if (props.state.onKeyDown(e) && e.key === 'Escape' && !props.inSheet) {
            e.currentTarget.blur();
          }
        }}
      />
      <Show when={expanded()}>
        <div class={props.inSheet ? 'gsearch-results-sheet' : 'gsearch-pop'}>
          <ResultList state={props.state} prefix={props.prefix} />
        </div>
      </Show>
    </div>
  );
}

/**
 * The top-nav search box. An inline field with a results popover on wider
 * screens; a button that opens a bottom sheet on phones. `/` focuses it.
 */
export function GlobalSearch() {
  const [sheetOpen, setSheetOpen] = createSignal(false);
  const state = createSearchState(() => setSheetOpen(false));
  let input: HTMLInputElement | undefined;

  function openSearch() {
    if (window.matchMedia(PHONE_QUERY).matches) {
      setSheetOpen(true);
    } else {
      input?.focus();
    }
  }

  function closeSheet() {
    setSheetOpen(false);
    state.setQuery('');
  }

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isSlashShortcut(e)) {
        e.preventDefault();
        openSearch();
      }
    };
    document.addEventListener('keydown', onKey);
    onCleanup(() => document.removeEventListener('keydown', onKey));
  });

  return (
    <div class='gsearch'>
      <SearchField state={state} prefix='gsearch' ref={el => (input = el)} />
      <button type='button' class='gsearch-trigger' aria-label='Search' onClick={() => setSheetOpen(true)}>
        <svg viewBox='0 0 16 16' width='16' height='16' aria-hidden='true'>
          <circle cx='7' cy='7' r='4.5' fill='none' stroke='currentColor' stroke-width='1.6' />
          <path d='M10.5 10.5 14 14' stroke='currentColor' stroke-width='1.6' stroke-linecap='round' />
        </svg>
      </button>
      <BottomSheet open={sheetOpen()} onClose={closeSheet} title='Search'>
        <SearchField
          state={state}
          prefix='gsearch-sheet'
          inSheet
          ref={el => {
            // After the sheet's own focus pass, which lands on its Close button.
            window.setTimeout(() => el.focus());
          }}
        />
      </BottomSheet>
    </div>
  );
}
