/**
 * How a player proves which player they are: their Player ID at a sanctioned
 * event, their last name at an unsanctioned one (whose public page shows last
 * names shortened), with the first name when two players share it. Used by
 * "Which player are you?" and by "This is me" in a player sheet, where the
 * answer has to be that player's.
 */

import { createSignal, Show } from 'solid-js';
import type { PlayerClaim } from '../../../shared/tournament/identify';
import { isSanctioned, type PublishedView, type TournamentView } from '../../../shared/tournament/view';
import { ApiError, identifyPlayer } from '../../lib/tournament/api';
import { ErrorLine, Field } from './Field';

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export interface Identified {
  claim: PlayerClaim;
  key: string;
  view: PublishedView;
  /** The token to keep, when this device just became the one that reports for the player. */
  reportToken?: string;
  /** False when another device reports for them. */
  reporter?: boolean;
}

export function IdentifyForm(props: {
  view: TournamentView;
  idPrefix: string;
  submitLabel: string;
  /** The player the answer must be, when there is one. */
  expect?: string;
  /** Take focus on opening, as the sheet's form does once "This is me" is pressed. */
  autofocus?: boolean;
  onFound: (found: Identified) => void;
}) {
  const sanctioned = () => isSanctioned(props.view);
  const [value, setValue] = createSignal('');
  const [first, setFirst] = createSignal('');
  const [ambiguous, setAmbiguous] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const wrong = () => `That ${sanctioned() ? 'Player ID' : 'last name'} isn’t this player’s`;

  const claimOf = (): PlayerClaim =>
    sanctioned()
      ? { popId: value().trim() }
      : { lastName: value().trim(), ...(first().trim() ? { firstName: first().trim() } : {}) };
  /** Why it failed: in a sheet, any miss is that it isn't this player; two sharing a last name asks for more. */
  const failure = (err: unknown) => {
    const twoShare = err instanceof ApiError && err.body?.ambiguous === true;
    setAmbiguous(twoShare);
    setError(props.expect !== undefined && !twoShare ? wrong() : errorText(err));
  };

  async function find(event: Event) {
    event.preventDefault();
    const claim = claimOf();
    setBusy(true);
    setError(null);
    try {
      const found = await identifyPlayer(props.view.code, claim);
      if (!found.key || (props.expect !== undefined && found.key !== props.expect)) {
        setError(wrong());
        return;
      }
      props.onFound({ ...found, claim, key: found.key });
    } catch (err) {
      failure(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form class='tm-identify' onSubmit={event => void find(event)}>
      <Field id={`${props.idPrefix}-id`} label={sanctioned() ? 'Player ID' : 'Last name'}>
        <input
          id={`${props.idPrefix}-id`}
          ref={el => {
            if (props.autofocus) {
              queueMicrotask(() => el.focus());
            }
          }}
          class='tm-input'
          inputmode={sanctioned() ? 'numeric' : undefined}
          autocomplete={sanctioned() ? 'off' : 'family-name'}
          value={value()}
          onInput={e => setValue(sanctioned() ? e.currentTarget.value.replace(/\D/g, '') : e.currentTarget.value)}
        />
      </Field>
      <Show when={ambiguous()}>
        <Field id={`${props.idPrefix}-first`} label='First name'>
          <input
            id={`${props.idPrefix}-first`}
            class='tm-input'
            autocomplete='given-name'
            value={first()}
            onInput={e => setFirst(e.currentTarget.value)}
          />
        </Field>
      </Show>
      <button type='submit' class='btn btn-primary' disabled={busy() || !value().trim()}>
        {props.submitLabel}
      </button>
      <ErrorLine message={error()} />
    </form>
  );
}
