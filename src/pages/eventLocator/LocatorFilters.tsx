import { For } from 'solid-js';
import type { EventKind } from '../../../shared/events/types';
import { Segmented } from '../../components/Segmented';
import type { DistanceUnit } from '../../lib/events/geo';
import type { WindowDays } from '../../lib/events/viewState';
import { KIND_LABEL } from './EventList';
import { RadiusControl } from './RadiusControl';

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

/** Every filter the locator has. The desktop panel and the phone sheet both show all of them. */
export interface LocatorFiltersProps {
  kinds: ReadonlySet<EventKind>;
  /** Kinds with any events anywhere; a kind with none gets no chip. */
  available: Record<EventKind, number> | null;
  windowDays: WindowDays;
  unit: DistanceUnit;
  radius: number;
  onToggleKind: (kind: EventKind) => void;
  onWindow: (days: WindowDays) => void;
  onUnit: (unit: DistanceUnit) => void;
  onRadiusInput: (radius: number) => void;
  onRadiusCommit: () => void;
}

const toKey = (days: WindowDays): WindowKey => (days === null ? 'all' : (String(days) as WindowKey));
const fromKey = (key: WindowKey): WindowDays => (key === 'all' ? null : (Number(key) as 7 | 30));

/** "30 days", or "All dates" where the control just says "All". */
export function windowText(days: WindowDays): string {
  return days === null ? 'All dates' : `${days} days`;
}

/** The sliders glyph on both filter buttons (the map's on phones, the bar's on desktop). */
export function FiltersIcon() {
  return (
    <svg viewBox='0 0 24 24' aria-hidden='true'>
      <path d='M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1' />
      <circle cx='15' cy='6' r='2' />
      <circle cx='9' cy='12' r='2' />
      <circle cx='17' cy='18' r='2' />
    </svg>
  );
}

function KindChips(props: LocatorFiltersProps) {
  const chips = () => KIND_CHIPS.filter(chip => !props.available || props.available[chip.kind] > 0);
  return (
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
  );
}

/** The filter room: each control under its label, hairlines between. */
export function LocatorFilters(props: LocatorFiltersProps) {
  return (
    <>
      <div class='group'>
        <p class='group-label'>Event types</p>
        <KindChips {...props} />
      </div>
      <div class='group'>
        <p class='group-label'>How far ahead</p>
        <Segmented
          options={WINDOW_OPTIONS}
          selected={toKey(props.windowDays)}
          onSelect={key => props.onWindow(fromKey(key))}
          ariaLabel='How far ahead'
        />
      </div>
      <div class='group'>
        <p class='group-label'>Within</p>
        <RadiusControl
          radius={props.radius}
          unit={props.unit}
          onInput={props.onRadiusInput}
          onCommit={props.onRadiusCommit}
        />
      </div>
      <div class='group'>
        <p class='group-label'>Units</p>
        <Segmented options={UNIT_OPTIONS} selected={props.unit} onSelect={props.onUnit} ariaLabel='Distance unit' />
      </div>
    </>
  );
}
