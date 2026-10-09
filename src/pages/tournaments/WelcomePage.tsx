/**
 * /welcome: the age check a new sign-up waits on before it has an account
 * (functions/api/auth/age.ts). The birth date goes to the server, which keeps
 * the year alone and only for someone 18 or older; a minor is told so and
 * nothing about them is kept. Once in, the page goes where sign-in started.
 */

import { A } from '@solidjs/router';
import { createSignal, Match, Switch } from 'solid-js';
import { ApiError, call, errorText, json } from '../../lib/tournament/api';
import { ErrorLine, Field } from './Field';
import { TournamentHero } from './Hero';

type Stage = 'asking' | 'sending' | 'refused' | 'expired';

export function WelcomePage() {
  const [birthDate, setBirthDate] = createSignal('');
  const [stage, setStage] = createSignal<Stage>('asking');
  const [error, setError] = createSignal<string | null>(null);

  async function send(event: SubmitEvent) {
    event.preventDefault();
    setStage('sending');
    setError(null);
    try {
      const { next } = await call<{ next: string }>('/api/auth/age', json('POST', { birthDate: birthDate() }));
      // A full load, so every part of the page reads the new session.
      window.location.assign(next);
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      setStage(status === 403 ? 'refused' : status === 410 ? 'expired' : 'asking');
      setError(errorText(err));
    }
  }

  return (
    <div class='tm-page tm-narrow'>
      <TournamentHero title='Birth date' trail={false} />
      <section class='tm-box'>
        <Switch>
          <Match when={stage() === 'refused' || stage() === 'expired'}>
            <div class='tm-box-bar'>
              <p>{error()}</p>
            </div>
            <Switch>
              <Match when={stage() === 'expired'}>
                <div class='tm-box-bar'>
                  <A class='btn btn-secondary' href='/settings'>
                    Sign in
                  </A>
                </div>
              </Match>
            </Switch>
          </Match>
          <Match when={true}>
            <form class='tm-box-bar tm-add-row' onSubmit={event => void send(event)}>
              <Field id='welcome-birth' label='Birth date'>
                <input
                  id='welcome-birth'
                  class='tm-input'
                  type='date'
                  required
                  autocomplete='bday'
                  value={birthDate()}
                  onInput={event => setBirthDate(event.currentTarget.value)}
                />
              </Field>
              <button type='submit' class='btn btn-primary' disabled={stage() === 'sending' || !birthDate()}>
                Continue
              </button>
              <ErrorLine message={error()} />
            </form>
          </Match>
        </Switch>
      </section>
    </div>
  );
}
