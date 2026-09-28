/**
 * A player's decklist for the event: their profile (so staff can match it to
 * the player list), the archetype, and the list pasted from PTCGL. The parse
 * runs as they type, so a list that is short a card says so before it is sent.
 */

import { createEffect, createResource, createSignal, For, Show } from 'solid-js';
import { parseDecklist } from '../../../shared/tournament/decklist';
import type { PlayerProfile } from '../../../shared/tournament/profile';
import { fetchDecklists, submitDecklist, withdrawDecklist } from '../../lib/tournament/api';
import { session, setSession } from './session';
import { latestValue } from '../../lib/resource';
import { DeckCombo } from '../live/LiveDeck';
import { deckOptions } from './deckOptions';
import { ConfirmAction } from './ConfirmAction';
import { ErrorLine, Field } from './Field';
import { emptyProfile, ProfileFields, profileProblems } from './ProfileFields';
import { SignIn } from './SignIn';

function Form(props: { code: string; archetypes: boolean }) {
  const [mine, { refetch }] = createResource(() => fetchDecklists(props.code).then(result => result.mine));
  const [profile, setProfile] = createSignal<PlayerProfile>(emptyProfile(latestValue(session)?.user));
  const [deck, setDeck] = createSignal('');
  const [archetype, setArchetype] = createSignal<string | null>(null);
  const [touched, setTouched] = createSignal(false);
  const [status, setStatus] = createSignal<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = createSignal<string | null>(null);
  const parsed = () => parseDecklist(deck());

  createEffect(() => {
    const existing = latestValue(mine);
    if (existing && !touched()) {
      setDeck(existing.deck);
      setArchetype(existing.archetype);
      setProfile({
        popId: existing.popId,
        firstName: existing.firstName,
        lastName: existing.lastName,
        birthDate: existing.birthDate
      });
    }
  });

  async function submit(event: Event) {
    event.preventDefault();
    setTouched(true);
    if (Object.keys(profileProblems(profile())).length > 0 || !deck().trim()) {
      return;
    }
    setStatus('sending');
    setError(null);
    try {
      const saved = profile();
      await submitDecklist(props.code, deck(), saved, props.archetypes ? archetype() : null);
      setSession(prev => (prev?.user ? { ...prev, user: { ...prev.user, ...saved } } : prev));
      setStatus('sent');
      void refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('idle');
    }
  }

  async function withdraw() {
    await withdrawDecklist(props.code).catch(err => setError(String(err)));
    setDeck('');
    void refetch();
  }

  return (
    <form class='tm-form' onSubmit={event => void submit(event)}>
      <ProfileFields
        idPrefix='deck'
        value={profile()}
        errors={touched() ? profileProblems(profile()) : {}}
        onChange={value => {
          setTouched(true);
          setProfile(value);
        }}
      />
      <Show when={props.archetypes}>
        {/* A wrapping label, since the picker's input takes no id. */}
        <label class='tm-field'>
          <span class='tm-label'>Deck</span>
          <DeckCombo
            decks={latestValue(deckOptions) ?? []}
            selected={archetype() ? { label: archetype() as string } : undefined}
            placeholder='Search archetypes'
            onPick={picked => setArchetype(picked.label)}
          />
        </label>
      </Show>
      <Field id='deck-list' label='Decklist'>
        <textarea
          id='deck-list'
          class='tm-input tm-textarea tm-decklist-input'
          placeholder='Paste your list from PTCGL'
          value={deck()}
          onInput={e => {
            setTouched(true);
            setDeck(e.currentTarget.value);
          }}
        />
      </Field>
      <Show when={deck().trim()}>
        <p class='muted num'>{parsed().total} cards</p>
        <ul class='tm-problems'>
          <For each={parsed().problems}>{problem => <li>{problem}</li>}</For>
        </ul>
      </Show>
      <div class='tm-actions'>
        <button type='submit' class='btn btn-primary' disabled={status() === 'sending'}>
          {latestValue(mine) ? 'Update decklist' : 'Submit decklist'}
        </button>
        <Show when={latestValue(mine)}>
          <ConfirmAction
            class='btn btn-ghost'
            label='Withdraw'
            question='Withdraw your decklist?'
            onConfirm={() => void withdraw()}
          />
        </Show>
        <Show when={status() === 'sent'}>
          <span class='muted'>Submitted</span>
        </Show>
      </div>
      <ErrorLine message={error()} />
    </form>
  );
}

export function DecklistForm(props: { code: string; archetypes: boolean }) {
  return (
    <Show
      when={latestValue(session)?.user}
      fallback={
        <Show when={latestValue(session)}>
          {s => <SignIn providers={s().providers} next={`/t/${props.code}?tab=decklist`} />}
        </Show>
      }
    >
      <Form code={props.code} archetypes={props.archetypes} />
    </Show>
  );
}
