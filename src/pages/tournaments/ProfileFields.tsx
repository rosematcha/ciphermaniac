import { type PlayerProfile, profileErrors } from '../../../shared/tournament/profile';
import { Field } from './Field';

/**
 * TOM keeps only a birth year and writes every birth date as 02/27 of it, so
 * the form asks for the year and stores it the same way.
 */
export const birthYearOf = (birthDate: string) => birthDate.slice(-4);
export const birthDateFor = (year: string) => (/^\d{4}$/.test(year.trim()) ? `02/27/${year.trim()}` : year.trim());

export function emptyProfile(user?: Partial<Record<keyof PlayerProfile, string | null>> | null): PlayerProfile {
  return {
    popId: user?.popId ?? '',
    firstName: user?.firstName ?? '',
    lastName: user?.lastName ?? '',
    birthDate: user?.birthDate ?? ''
  };
}

export function profileProblems(profile: PlayerProfile) {
  const errors = profileErrors(profile);
  return errors.birthDate ? { ...errors, birthDate: 'Enter a four-digit year' } : errors;
}

/** POP ID, name and birth year: what an organizer's player list knows a player by. */
export function ProfileFields(props: {
  idPrefix: string;
  value: PlayerProfile;
  errors: Partial<Record<keyof PlayerProfile, string>>;
  onChange: (profile: PlayerProfile) => void;
}) {
  const set = (key: keyof PlayerProfile, value: string) => props.onChange({ ...props.value, [key]: value });
  const id = (key: string) => `${props.idPrefix}-${key}`;
  return (
    <div class='tm-grid-fields tm-profile-fields'>
      <Field id={id('first')} label='First name' error={props.errors.firstName}>
        <input
          id={id('first')}
          class='tm-input'
          autocomplete='given-name'
          value={props.value.firstName}
          onInput={e => set('firstName', e.currentTarget.value)}
        />
      </Field>
      <Field id={id('last')} label='Last name' error={props.errors.lastName}>
        <input
          id={id('last')}
          class='tm-input'
          autocomplete='family-name'
          value={props.value.lastName}
          onInput={e => set('lastName', e.currentTarget.value)}
        />
      </Field>
      <Field id={id('pop')} label='Player ID' error={props.errors.popId}>
        <input
          id={id('pop')}
          class='tm-input'
          inputmode='numeric'
          value={props.value.popId}
          onInput={e => set('popId', e.currentTarget.value.replace(/\D/g, ''))}
        />
      </Field>
      <Field id={id('year')} label='Birth year' error={props.errors.birthDate}>
        <input
          id={id('year')}
          class='tm-input'
          inputmode='numeric'
          maxLength={4}
          value={birthYearOf(props.value.birthDate)}
          onInput={e => set('birthDate', birthDateFor(e.currentTarget.value))}
        />
      </Field>
    </div>
  );
}
