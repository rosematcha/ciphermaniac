import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import type { LiveCut } from '../../../shared/live/types';
import { roundName, roundShort } from '../../../shared/live/rounds';
import type { StatusFilter } from '../../../shared/live/view';
import { BottomSheet } from '../../components/BottomSheet';
import { Chip, ChipGroup, SearchInput } from '../../components/Chip';
import { Segmented } from '../../components/Segmented';
import type { ReportedDeck } from './LiveDeck';

export type LiveView = 'pairings' | 'standings';

/**
 * Where the filters stop being a row beside the search and become a sheet.
 * Must stay in step with the `max-width: 900px` block in `pages/live.css`.
 */
const PHONE_QUERY = '(max-width: 900px)';

/** Everything the two tables are filtered and shaped by. */
export interface LiveFilters {
  query: string;
  /** The round being shown; equal to `current` unless one is pinned. */
  round: number;
  /** The round the event is actually on. */
  current: number;
  /** Where the top cut starts, once it has. */
  cut?: LiveCut;
  pinned: boolean;
  view: LiveView;
  status: StatusFilter;
  /** Archetype label, or `''` for any. */
  deck: string;
  following: boolean;
}

export interface LiveFilterActions {
  setQuery: (value: string) => void;
  /** Null returns to the live round and unpins. */
  setRound: (round: number | null) => void;
  setView: (view: LiveView) => void;
  setStatus: (status: StatusFilter) => void;
  setDeck: (deck: string | null) => void;
  setFollowing: (on: boolean) => void;
  clear: () => void;
}

const VIEW_OPTIONS: { value: LiveView; label: string }[] = [
  { value: 'pairings', label: 'Pairings' },
  { value: 'standings', label: 'Standings' }
];

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'playing', label: 'Playing' },
  { value: 'decided', label: 'Decided' }
];

interface ControlsProps {
  filters: LiveFilters;
  on: LiveFilterActions;
  /** Archetypes reported for at least one seat in the round, most reported first. */
  decks: readonly ReportedDeck[];
  /** Rows the current filters leave, for the sheet's apply button. */
  count: number;
}

/**
 * One row at every width: search, the round, and the rest behind a trigger —
 * a panel under the button on a desktop, a sheet on a phone.
 *
 * The fifteen round chips this replaces wrapped into five rows of a sticky bar
 * on a phone, roughly half the viewport, for the control people change least:
 * the page already opens on the round the event is on.
 */
export function LiveControls(props: ControlsProps) {
  const [open, setOpen] = createSignal(false);
  const [phone, setPhone] = createSignal(false);
  let root!: HTMLDivElement;
  let trigger!: HTMLButtonElement;

  onMount(() => {
    const media = matchMedia(PHONE_QUERY);
    const sync = () => setPhone(media.matches);
    sync();
    media.addEventListener('change', sync);
    // The desktop panel is a popover, so it closes the way one does.
    const onPointer = (e: PointerEvent) => {
      if (open() && !media.matches && !root.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open() && !media.matches) {
        setOpen(false);
        trigger.focus();
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    onCleanup(() => {
      media.removeEventListener('change', sync);
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    });
  });

  const chips = () => summary(props.filters, props.on);
  const active = () => countActive(props.filters);
  const noun = () => (props.filters.view === 'standings' ? 'players' : 'tables');

  return (
    <>
      <div class='live-bar' ref={root}>
        <SearchInput value={props.filters.query} onInput={props.on.setQuery} placeholder='Name or table...' />
        <RoundStepper filters={props.filters} on={props.on} open={open()} onBrowse={() => setOpen(true)} />
        <button
          ref={trigger}
          type='button'
          class='filters-btn live-filters-btn'
          classList={{ 'is-active': active() > 0 }}
          aria-haspopup='dialog'
          aria-expanded={open() ? 'true' : 'false'}
          aria-label='Refine tables'
          onClick={() => setOpen(o => !o)}
        >
          <FiltersIcon />
          <Show when={active() > 0}>
            <span class='fb-count'>{active()}</span>
          </Show>
        </button>
        <Show when={open() && !phone()}>
          <div class='live-filters-panel filter-room' role='dialog' aria-label='Refine tables'>
            <FilterGroups {...props} />
          </div>
        </Show>
      </div>

      <Show when={chips().length > 0}>
        <div class='filter-strip' aria-label='Active filters'>
          <For each={chips()}>
            {chip => (
              <button
                type='button'
                class='mini-chip'
                aria-label={`Remove ${chip.label} filter`}
                onClick={() => chip.clear()}
              >
                {chip.label}
                <span class='mc-x' aria-hidden='true'>
                  ✕
                </span>
              </button>
            )}
          </For>
        </div>
      </Show>

      <Show when={phone()}>
        <BottomSheet
          open={open()}
          onClose={() => setOpen(false)}
          title='Refine'
          ariaLabel='Refine tables'
          footer={
            <>
              <button class='sheet-clear' type='button' onClick={props.on.clear}>
                Clear
              </button>
              <button class='btn sheet-apply' type='button' onClick={() => setOpen(false)}>
                Show {props.count.toLocaleString()} {noun()}
              </button>
            </>
          }
        >
          <FilterGroups {...props} />
        </BottomSheet>
      </Show>
    </>
  );
}

/** The filters themselves, shared by the desktop panel and the phone sheet. */
function FilterGroups(props: ControlsProps) {
  return (
    <>
      <div class='group'>
        <p class='group-label'>Show</p>
        <Segmented<LiveView>
          options={VIEW_OPTIONS}
          selected={props.filters.view}
          onSelect={props.on.setView}
          ariaLabel='Pairings or standings'
        />
      </div>

      <div class='group'>
        <p class='group-label'>Round</p>
        <ChipGroup
          options={roundOptions(props.filters.current, props.filters.cut)}
          selected={String(props.filters.round)}
          onSelect={value => props.on.setRound(Number(value))}
        />
      </div>

      <Show when={props.filters.view === 'pairings'}>
        <div class='group'>
          <p class='group-label'>Table status</p>
          <Segmented<StatusFilter>
            options={STATUS_OPTIONS}
            selected={props.filters.status}
            onSelect={props.on.setStatus}
            ariaLabel='Table status'
          />
        </div>
      </Show>

      <div class='group'>
        <p class='group-label'>Players</p>
        <Chip pressed={props.filters.following} onClick={() => props.on.setFollowing(!props.filters.following)}>
          Following only
        </Chip>
      </div>

      <Show when={props.decks.length > 0}>
        <div class='group'>
          <p class='group-label'>Deck</p>
          {/* No "Any" option: it is the absence of a filter, and as a chip it
              spent the sheet's whole accent budget saying nothing is set.
              Pressing the chosen deck again clears it. */}
          <ChipGroup
            options={props.decks.map(deck => ({ value: deck.label, label: deck.label }))}
            selected={props.filters.deck}
            onSelect={value => props.on.setDeck(value === props.filters.deck ? null : value)}
          />
        </div>
      </Show>
    </>
  );
}

/**
 * `‹ R8 ›`, with the label opening the full list so any round stays one jump
 * away. A pinned past round marks itself, because the hero says "Round 12"
 * while the table shows round 7 and nothing else reconciles them.
 */
function RoundStepper(props: { filters: LiveFilters; on: LiveFilterActions; open: boolean; onBrowse: () => void }) {
  const at = () => props.filters.round;
  return (
    <span class='round-step'>
      <button
        type='button'
        class='round-step-arrow'
        aria-label='Previous round'
        disabled={at() <= 1}
        onClick={() => props.on.setRound(at() - 1)}
      >
        ‹
      </button>
      <button
        type='button'
        class='round-step-label'
        classList={{ 'is-pinned': props.filters.pinned }}
        aria-haspopup='dialog'
        aria-expanded={props.open ? 'true' : 'false'}
        aria-label={`${roundName(at(), props.filters.cut)}; choose a round`}
        onClick={() => props.onBrowse()}
      >
        {roundShort(at(), props.filters.cut)}
      </button>
      <button
        type='button'
        class='round-step-arrow'
        aria-label='Next round'
        disabled={at() >= props.filters.current}
        onClick={() => props.on.setRound(at() + 1)}
      >
        ›
      </button>
    </span>
  );
}

function FiltersIcon() {
  return (
    <svg
      width='16'
      height='16'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      stroke-width='2'
      stroke-linecap='round'
      stroke-linejoin='round'
      aria-hidden='true'
    >
      <path d='M3 5h18l-7 8v5.5l-4 2V13L3 5z' />
    </svg>
  );
}

function roundOptions(current: number, cut: LiveCut | undefined): { value: string; label: string }[] {
  return Array.from({ length: current }, (_, i) => ({
    value: String(i + 1),
    label: i + 1 === current ? `${roundShort(i + 1, cut)} · live` : roundShort(i + 1, cut)
  }));
}

function countActive(filters: LiveFilters): number {
  return [filters.pinned, filters.status !== 'all', filters.following, Boolean(filters.deck)].filter(Boolean).length;
}

/** The set filters as removable chips, so the row count always says what produced it. */
function summary(filters: LiveFilters, on: LiveFilterActions): { label: string; clear: () => void }[] {
  const chips: { label: string; clear: () => void }[] = [];
  if (filters.pinned) {
    chips.push({
      label: `${roundName(filters.round, filters.cut)} · live is ${roundShort(filters.current, filters.cut)}`,
      clear: () => on.setRound(null)
    });
  }
  if (filters.status !== 'all') {
    chips.push({ label: filters.status === 'playing' ? 'Playing' : 'Decided', clear: () => on.setStatus('all') });
  }
  if (filters.following) {
    chips.push({ label: 'Following only', clear: () => on.setFollowing(false) });
  }
  if (filters.deck) {
    chips.push({ label: filters.deck, clear: () => on.setDeck(null) });
  }
  return chips;
}
