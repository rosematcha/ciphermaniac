import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { BottomSheet } from '../../components/BottomSheet';
import type { DistanceUnit } from '../../lib/events/geo';
import type { WindowDays } from '../../lib/events/viewState';
import { FiltersIcon, LocatorFilters, type LocatorFiltersProps, windowText } from './LocatorFilters';

/** What the list shows: the count, and the dates and radius behind it. */
interface ScopeProps {
  count: string;
  windowDays: WindowDays;
  radius: number;
  unit: DistanceUnit;
}

const scopeText = (windowDays: WindowDays, radius: number, unit: DistanceUnit) =>
  `${windowText(windowDays)} · ${radius} ${unit}`;

/** Phones: the line under the map that states the result and opens the filter sheet. */
export function FilterSeam(props: ScopeProps & { onOpen: () => void }) {
  return (
    <button type='button' class='el-seam' aria-haspopup='dialog' onClick={() => props.onOpen()}>
      <span class='el-seam-count'>{props.count}</span>
      <span>{scopeText(props.windowDays, props.radius, props.unit)}</span>
    </button>
  );
}

/**
 * Desktop: the line over the list that states the result, with every filter
 * in a panel under its button. A press outside the bar or Escape closes it.
 */
export function FilterBar(props: ScopeProps & LocatorFiltersProps) {
  let root!: HTMLDivElement;
  let button!: HTMLButtonElement;
  const [open, setOpen] = createSignal(false);
  onMount(() => {
    const onPointer = (e: PointerEvent) => {
      if (open() && !root.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open()) {
        setOpen(false);
        button.focus();
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    onCleanup(() => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    });
  });
  return (
    <div class='el-filterbar' ref={root}>
      <span class='el-count'>{props.count}</span>
      <span class='el-scope'>{scopeText(props.windowDays, props.radius, props.unit)}</span>
      <button
        ref={button}
        type='button'
        class='btn btn-secondary el-filters-button'
        aria-expanded={open()}
        onClick={() => setOpen(o => !o)}
      >
        <FiltersIcon />
        Filters
      </button>
      <Show when={open()}>
        <div class='el-filters-panel filter-room' role='dialog' aria-label='Filters'>
          <LocatorFilters {...props} />
        </div>
      </Show>
    </div>
  );
}

export interface FilterSheetProps extends LocatorFiltersProps {
  open: boolean;
  onClose: () => void;
  /** Events the filters show now, or null before the area has loaded. */
  total: number | null;
}

/** Phones: every filter in a bottom sheet, closed by a button that says what it will show. */
export function FilterSheet(props: FilterSheetProps) {
  const label = () => (props.total === null ? 'Done' : `Show ${props.total} event${props.total === 1 ? '' : 's'}`);
  return (
    <BottomSheet
      open={props.open}
      onClose={() => props.onClose()}
      title='Filters'
      footer={
        <button type='button' class='btn sheet-apply' onClick={() => props.onClose()}>
          {label()}
        </button>
      }
    >
      <LocatorFilters {...props} />
    </BottomSheet>
  );
}
