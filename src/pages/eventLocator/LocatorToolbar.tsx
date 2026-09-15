import { For } from 'solid-js';
import type { EventKind } from '../../../shared/events/types';
import { Segmented } from '../../components/Segmented';
import type { DistanceUnit } from '../../lib/events/geo';
import type { WindowDays } from '../../lib/events/viewState';
import { KIND_LABEL } from './EventList';

type WindowKey = '7' | '30' | 'all';

const WINDOW_OPTIONS: { value: WindowKey; label: string }[] = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: 'all', label: 'All' }
];
const UNIT_OPTIONS: { value: DistanceUnit; label: string }[] = [
  { value: 'mi', label: 'mi' },
  { value: 'km', label: 'km' }
];
const KIND_CHIPS: { kind: EventKind; label: string }[] = [
  { kind: 'cup', label: `League ${KIND_LABEL.cup}s` },
  { kind: 'challenge', label: `${KIND_LABEL.challenge}s` },
  { kind: 'prerelease', label: `${KIND_LABEL.prerelease}s` },
  { kind: 'local', label: 'Locals' }
];

export interface LocatorToolbarProps {
  kinds: ReadonlySet<EventKind>;
  /** Kinds with any events anywhere; a kind with none gets no chip. */
  available: Record<EventKind, number> | null;
  windowDays: WindowDays;
  unit: DistanceUnit;
  count: string;
  onToggleKind: (kind: EventKind) => void;
  onWindow: (days: WindowDays) => void;
  onUnit: (unit: DistanceUnit) => void;
}

const toKey = (days: WindowDays): WindowKey => (days === null ? 'all' : (String(days) as WindowKey));
const fromKey = (key: WindowKey): WindowDays => (key === 'all' ? null : (Number(key) as 7 | 30));

export function LocatorToolbar(props: LocatorToolbarProps) {
  const chips = () => KIND_CHIPS.filter(chip => !props.available || props.available[chip.kind] > 0);
  return (
    <div class='el-bar'>
      <div class='chips' role='group' aria-label='Event types'>
        <For each={chips()}>
          {chip => (
            <button
              type='button'
              class='chip'
              aria-pressed={props.kinds.has(chip.kind)}
              onClick={() => props.onToggleKind(chip.kind)}
            >
              {chip.label}
            </button>
          )}
        </For>
      </div>
      <Segmented
        options={WINDOW_OPTIONS}
        selected={toKey(props.windowDays)}
        onSelect={key => props.onWindow(fromKey(key))}
        ariaLabel='How far ahead'
      />
      <Segmented options={UNIT_OPTIONS} selected={props.unit} onSelect={props.onUnit} ariaLabel='Distance unit' />
      {/* Always mounted: a live region that appears with its text is not announced. */}
      <span class='el-count' aria-live='polite'>
        {props.count}
      </span>
    </div>
  );
}
