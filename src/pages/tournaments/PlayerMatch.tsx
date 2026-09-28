/**
 * A player's own match at an event where players report results. They say
 * who they are once (Player ID, or at an unsanctioned event their last name),
 * then see their table and press how it went. The button they pressed is the
 * state: accented once reported, marked when the opponent says otherwise, and
 * fixed once the result stands. A report can change until it locks (see
 * shared/tournament/reports.ts).
 */

import { createEffect, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import type { PlayerClaim } from '../../../shared/tournament/identify';
import type { PlayerResult } from '../../../shared/tournament/reports';
import { isSanctioned, type PublishedView, type TournamentView } from '../../../shared/tournament/view';
import { ApiError, identifyPlayer, reportAsPlayer } from '../../lib/tournament/api';
import { currentMatchOf, namesById, recordsBefore, reportState, roundLabel } from '../../lib/tournament/present';
import { Clock } from './Clock';
import { ErrorLine, Field } from './Field';

const claimKey = (code: string) => `cm-tournament-player:${code}`;

function storedClaim(code: string): PlayerClaim | null {
  try {
    return JSON.parse(localStorage.getItem(claimKey(code)) ?? 'null') as PlayerClaim | null;
  } catch {
    return null;
  }
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

interface Props {
  view: TournamentView;
  me: string | null;
  onMe: (key: string | null) => void;
  onView: (view: PublishedView) => void;
}

/** "Which player are you?": a Player ID, or a last name, with the first name when two share it. */
function WhichPlayer(props: Props & { onClaim: (claim: PlayerClaim) => void }) {
  const sanctioned = () => isSanctioned(props.view);
  const [value, setValue] = createSignal('');
  const [first, setFirst] = createSignal('');
  const [ambiguous, setAmbiguous] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);

  async function find(event: Event) {
    event.preventDefault();
    const claim: PlayerClaim = sanctioned()
      ? { popId: value().trim() }
      : { lastName: value().trim(), ...(first().trim() ? { firstName: first().trim() } : {}) };
    setBusy(true);
    setError(null);
    try {
      const found = await identifyPlayer(props.view.code, claim);
      props.onClaim(claim);
      props.onMe(found.key);
      props.onView(found.view);
    } catch (err) {
      setAmbiguous(err instanceof ApiError && err.body?.ambiguous === true);
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section class='tm-you tm-report' aria-label='Your match'>
      <p class='tm-report-ask'>Which player are you?</p>
      <form class='tm-report-entry' onSubmit={event => void find(event)}>
        <Field id='report-id' label={sanctioned() ? 'Player ID' : 'Last name'}>
          <input
            id='report-id'
            class='tm-input'
            inputmode={sanctioned() ? 'numeric' : undefined}
            autocomplete={sanctioned() ? 'off' : 'family-name'}
            value={value()}
            onInput={e => setValue(sanctioned() ? e.currentTarget.value.replace(/\D/g, '') : e.currentTarget.value)}
          />
        </Field>
        <Show when={ambiguous()}>
          <Field id='report-first' label='First name'>
            <input
              id='report-first'
              class='tm-input'
              autocomplete='given-name'
              value={first()}
              onInput={e => setFirst(e.currentTarget.value)}
            />
          </Field>
        </Show>
        <button type='submit' class='btn btn-primary' disabled={busy() || !value().trim()}>
          Find my match
        </button>
      </form>
      <ErrorLine message={error()} />
    </section>
  );
}

const CHOICES: { result: PlayerResult; label: string }[] = [
  { result: 'win', label: 'I won' },
  { result: 'loss', label: 'I lost' },
  { result: 'tie', label: 'Tie' }
];

/** The match and the three answers; which one is pressed says where the report stands. */
function MyMatch(props: Props & { me: string; claim: PlayerClaim; onForget: () => void }) {
  const [now, setNow] = createSignal(Date.now());
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [settling, setSettling] = createSignal(false);
  onMount(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    onCleanup(() => clearInterval(timer));
  });
  const names = () => namesById(props.view.tournament);
  const found = () => currentMatchOf(props.view.tournament, props.me);
  const state = () => {
    const f = found();
    return f && f.match.p2 !== null
      ? reportState(f, { pending: props.view.pending, reports: props.view.reports ?? [] }, props.me, now())
      : null;
  };
  const choices = () => (found()?.round.kind === 'elimination' ? CHOICES.filter(c => c.result !== 'tie') : CHOICES);

  async function send(result: PlayerResult) {
    setBusy(true);
    setError(null);
    try {
      props.onView((await reportAsPlayer(props.view.code, props.claim, result)).view);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function settle() {
    setSettling(true);
    const answer = await identifyPlayer(props.view.code, props.claim).catch(() => null);
    if (answer) {
      props.onView(answer.view);
    }
    // Clocks differ by a second or two; if the server did not settle it yet, ask again shortly.
    setTimeout(() => setSettling(false), 5000);
  }

  // Once both reports agree and lock, asking again writes the result in, so it shows as it stands.
  createEffect(() => {
    if (state()?.final && found()?.match.outcome === 'pending' && !settling()) {
      void settle();
    }
  });

  return (
    <section class='tm-you tm-report' aria-label='Your match'>
      <span class='tm-you-round'>
        {names().get(props.me)}
        <Show when={found()}>{f => <> · {roundLabel(f().round)}</>}</Show>
        <button type='button' class='btn btn-ghost tm-small' onClick={() => props.onForget()}>
          Not you?
        </button>
      </span>
      <Show when={found()} fallback={<strong>Not paired yet</strong>}>
        {f => (
          <>
            <Show when={f().match.table} fallback={<strong class='tm-report-table'>Bye</strong>}>
              <span class='tm-report-table'>
                <span class='tm-report-table-label'>Table</span> <span class='num'>{f().match.table}</span>
              </span>
            </Show>
            <span class='tm-report-versus'>
              <Show when={f().match.p1 === props.me ? f().match.p2 : f().match.p1}>
                {opponent => (
                  <span>
                    vs {names().get(opponent())}{' '}
                    <span class='muted num'>{recordsBefore(f().pod, f().round).get(opponent())}</span>
                  </span>
                )}
              </Show>
              <Clock round={f().round} />
            </span>
          </>
        )}
      </Show>
      <Show when={state()}>
        {s => (
          <div class='tm-report-choices' role='group' aria-label='Report your result'>
            <For each={choices()}>
              {choice => (
                <button
                  type='button'
                  class='btn'
                  classList={{
                    'btn-primary': s().chosen === choice.result && !s().disputed,
                    'btn-secondary': s().chosen !== choice.result || s().disputed,
                    'is-chosen': s().chosen === choice.result,
                    'is-disputed': s().chosen === choice.result && s().disputed
                  }}
                  aria-pressed={s().chosen === choice.result}
                  disabled={busy() || ((s().locked || s().final) && s().chosen !== choice.result)}
                  aria-disabled={s().locked || s().final ? 'true' : undefined}
                  onClick={() => {
                    if (!s().locked && !s().final) {
                      void send(choice.result);
                    }
                  }}
                >
                  {choice.label}
                  <Show when={s().chosen === choice.result && s().disputed}>
                    <span class='sr-only'> (your opponent reported otherwise)</span>
                  </Show>
                </button>
              )}
            </For>
          </div>
        )}
      </Show>
      <ErrorLine message={error()} />
    </section>
  );
}

/** The player's match, once they say who they are; until then, the question. */
export function PlayerMatch(props: Props) {
  // eslint-disable-next-line solid/reactivity -- read once for the event the page opened on
  const [claim, setClaim] = createSignal(storedClaim(props.view.code));
  function remember(next: PlayerClaim | null) {
    if (next) {
      localStorage.setItem(claimKey(props.view.code), JSON.stringify(next));
    } else {
      localStorage.removeItem(claimKey(props.view.code));
    }
    setClaim(next);
  }
  return (
    <Show
      when={claim() && props.me ? { claim: claim() as PlayerClaim, me: props.me } : null}
      fallback={<WhichPlayer {...props} onClaim={remember} />}
    >
      {who => (
        <MyMatch
          {...props}
          me={who().me}
          claim={who().claim}
          onForget={() => {
            remember(null);
            props.onMe(null);
          }}
        />
      )}
    </Show>
  );
}
