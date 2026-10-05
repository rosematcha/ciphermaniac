/**
 * What a store tells players about itself, as fields: on the store
 * application, prefilled from the league lookup, and in store settings. A
 * field the server would refuse says why once it has been left, or once the
 * form tried to send (`checked`).
 */

import { createSignal, For } from 'solid-js';
import { STORE_LIMITS, type StoreDetails } from '../../../shared/accounts/stores';
import { detailsProblems, timeZones, zoneName } from '../../lib/tournament/stores';
import '../../styles/pages/tournament-store-forms.css';
import { Field } from './Field';

interface FieldSpec {
  key: keyof StoreDetails;
  label: string;
  max: number;
  type?: string;
  placeholder?: string;
  autocomplete?: string;
  wide?: boolean;
}

const L = STORE_LIMITS;

const FIELDS: FieldSpec[] = [
  { key: 'name', label: 'Store name', max: L.name, wide: true, autocomplete: 'organization' },
  { key: 'address', label: 'Address', max: L.address, wide: true, autocomplete: 'street-address' },
  { key: 'city', label: 'City', max: L.city, autocomplete: 'address-level2' },
  { key: 'region', label: 'State or region', max: L.region, autocomplete: 'address-level1' },
  { key: 'postal', label: 'Postal code', max: L.postal, autocomplete: 'postal-code' },
  { key: 'country', label: 'Country', max: 2, placeholder: 'US', autocomplete: 'country' },
  { key: 'website', label: 'Website', max: L.url, type: 'url', placeholder: 'https://' },
  { key: 'discord', label: 'Discord', max: L.url, type: 'url', placeholder: 'https://discord.gg/' },
  { key: 'phone', label: 'Phone', max: L.phone, type: 'tel', autocomplete: 'tel' },
  { key: 'email', label: 'Email', max: L.email, type: 'email', autocomplete: 'email' }
];

export function StoreFields(props: {
  /** Prefix for the fields' ids, so two forms on a page never share one. */
  id: string;
  details: StoreDetails;
  timeZone: string;
  checked: boolean;
  onChange: (details: StoreDetails) => void;
  onTimeZone: (zone: string) => void;
}) {
  const [left, setLeft] = createSignal(new Set<keyof StoreDetails>());
  const problems = () => detailsProblems(props.details);
  const shown = (key: keyof StoreDetails) => (props.checked || left().has(key) ? problems()[key] : undefined);
  const fieldId = (key: string) => `${props.id}-${key}`;
  return (
    <div class='tm-store-fields'>
      <For each={FIELDS}>
        {spec => (
          <div classList={{ 'tm-store-wide': spec.wide === true }}>
            <Field id={fieldId(spec.key)} label={spec.label} error={shown(spec.key)}>
              <input
                id={fieldId(spec.key)}
                class='tm-input'
                type={spec.type ?? 'text'}
                maxLength={spec.max}
                placeholder={spec.placeholder}
                autocomplete={spec.autocomplete ?? 'off'}
                value={props.details[spec.key]}
                aria-invalid={shown(spec.key) ? 'true' : undefined}
                aria-describedby={shown(spec.key) ? `${fieldId(spec.key)}-error` : undefined}
                onInput={e => props.onChange({ ...props.details, [spec.key]: e.currentTarget.value })}
                onBlur={() => setLeft(prev => new Set(prev).add(spec.key))}
              />
            </Field>
          </div>
        )}
      </For>
      <div class='tm-store-wide'>
        <Field id={fieldId('zone')} label='Time zone'>
          <select
            id={fieldId('zone')}
            class='tm-select tm-select-full'
            onChange={e => props.onTimeZone(e.currentTarget.value)}
          >
            <For each={timeZones(props.timeZone)}>
              {zone => (
                <option value={zone} selected={zone === props.timeZone}>
                  {zone === props.timeZone
                    ? `${zone.replaceAll('_', ' ')} (${zoneName(zone)})`
                    : zone.replaceAll('_', ' ')}
                </option>
              )}
            </For>
          </select>
        </Field>
      </div>
      <div class='tm-store-wide'>
        <Field id={fieldId('details')} label='About the store'>
          <textarea
            id={fieldId('details')}
            class='tm-input tm-textarea'
            maxLength={L.details}
            value={props.details.details}
            onInput={e => props.onChange({ ...props.details, details: e.currentTarget.value })}
          />
        </Field>
      </div>
    </div>
  );
}
