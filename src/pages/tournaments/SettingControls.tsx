/**
 * The controls an event's settings are made with, shared by the new event
 * setup and the console's Event tab so the same setting is always the same
 * control: a two-way switch for sanctioned, player reporting and decklists,
 * and the three-way archetypes choice. Each sits in a settings row, the label
 * at left and the control at right.
 */

import { For, type JSX, Show } from 'solid-js';
import type { DeckVisibility } from '../../../shared/tournament/view';
import { Segmented } from '../../components/Segmented';

export const VISIBILITY_LABELS: Record<DeckVisibility, string> = {
  always: 'Shown to everyone',
  after: 'Shown once the event ends',
  off: 'Off'
};

/** One setting: its label at left, its control at right, and an optional line under the label. */
export function SettingRow(props: { label: string; for?: string; note?: string; children: JSX.Element }) {
  return (
    <div class='tm-set-row'>
      <span class='tm-set-label'>
        <Show when={props.for} fallback={<span>{props.label}</span>}>
          <label for={props.for}>{props.label}</label>
        </Show>
        <Show when={props.note}>
          <small>{props.note}</small>
        </Show>
      </span>
      <span class='tm-set-control'>{props.children}</span>
    </div>
  );
}

/** A setting that is on or off, as a segmented switch with its own words for each side. */
export function Toggle(props: {
  label: string;
  value: boolean;
  on?: string;
  off?: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <Segmented
      options={[
        { value: 'on', label: props.on ?? 'On' },
        { value: 'off', label: props.off ?? 'Off' }
      ]}
      selected={props.value ? 'on' : 'off'}
      onSelect={value => props.onChange(value === 'on')}
      ariaLabel={props.label}
    />
  );
}

/** Whether and when players see each other's archetypes, or archetypes off for the event. */
export function ArchetypesSelect(props: {
  id: string;
  value: DeckVisibility;
  onChange: (value: DeckVisibility) => void;
}) {
  return (
    <select id={props.id} class='tm-select' onChange={e => props.onChange(e.currentTarget.value as DeckVisibility)}>
      <For each={Object.entries(VISIBILITY_LABELS)}>
        {([value, label]) => (
          <option value={value} selected={props.value === value}>
            {label}
          </option>
        )}
      </For>
    </select>
  );
}
