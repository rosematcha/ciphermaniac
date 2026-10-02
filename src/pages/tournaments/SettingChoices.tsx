/**
 * The settings choices beyond a switch that the new event setup and the
 * console's Event tab share: the kind of event, whether it takes decklists,
 * and how many Swiss rounds it plans. Apart from SettingControls, which ships
 * with the first page, so these load with the pages that use them.
 */

import { For } from 'solid-js';
import { EVENT_TYPE_LABELS, EVENT_TYPES, type EventType } from '../../../shared/tournament/types';
import { type DecklistMode, SETTINGS_LIMITS } from '../../../shared/tournament/view';
import { Segmented } from '../../components/Segmented';

const CAPS = Array.from({ length: SETTINGS_LIMITS.roundCap }, (_, i) => i + 1);

const DECKLIST_OPTIONS: { value: DecklistMode; label: string }[] = [
  { value: 'off', label: 'Disabled' },
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' }
];

const EVENT_TYPE_OPTIONS = EVENT_TYPES.map(value => ({ value, label: EVENT_TYPE_LABELS[value] }));

/** A League Cup or a League Challenge, which sets the rounds and whether there is a top cut. */
export function EventTypeSwitch(props: { value: EventType; onChange: (value: EventType) => void }) {
  return (
    <Segmented options={EVENT_TYPE_OPTIONS} selected={props.value} onSelect={props.onChange} ariaLabel='Event type' />
  );
}

/** Whether the event takes decklists, and if it does, whether players can send one now. */
export function DecklistsSwitch(props: { value: DecklistMode; onChange: (value: DecklistMode) => void }) {
  return (
    <Segmented options={DECKLIST_OPTIONS} selected={props.value} onSelect={props.onChange} ariaLabel='Decklists' />
  );
}

/**
 * How many Swiss rounds to plan: Play! Pokémon's number for the attendance
 * (`recommended`, when there are players to count), or a cap of at least
 * `min` (a sanctioned event plays three).
 */
export function RoundsSelect(props: {
  id: string;
  value: number;
  recommended?: number | undefined;
  min?: number;
  onChange: (value: number) => void;
}) {
  return (
    <select id={props.id} class='tm-select' onChange={e => props.onChange(Number(e.currentTarget.value))}>
      <option value={0} selected={props.value === 0}>
        {props.recommended ? `Recommended (${props.recommended} for this many players)` : 'Recommended for attendance'}
      </option>
      {/* A cap stored before the minimum held stays listed, so the select shows what is set. */}
      <For each={CAPS.filter(n => n >= (props.min ?? 1) || n === props.value)}>
        {n => (
          <option value={n} selected={props.value === n}>
            {n === 1 ? 'Capped at 1 round' : `Capped at ${n} rounds`}
          </option>
        )}
      </For>
    </select>
  );
}
