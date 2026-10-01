/**
 * A player's decklist for the event, with no account: they say who they are
 * the way the rest of the player side does (Player ID, name and birth year at
 * a sanctioned event; the name at an unsanctioned one), pick an archetype
 * when the event tracks them, and paste the list from TCG Live. The parse
 * runs as they type, so a list that is short a card says so before it is
 * sent, and sending one with problems asks first.
 *
 * Submitting adds a player who is not on the event's list yet. The device
 * remembers who sent the list and the token the server gave it, so coming
 * back shows the list to update or withdraw. The list is locked to that
 * device: another one sending the same details is refused, until staff
 * unlock it. A signed-in player's profile fills the form in, and once a
 * list is in at a sanctioned event, the account can take its POP ID ("Save
 * to my account"): sending a list never sets one, since a list may be sent
 * for a friend. An account that owns its list sees it on any of its devices.
 */

import { A } from '@solidjs/router';
import { createEffect, createMemo, createResource, createSignal, For, Show, untrack } from 'solid-js';
import { type DeckSection, parseDecklist } from '../../../shared/tournament/decklist';
import type { PlayerProfile } from '../../../shared/tournament/profile';
import { SETTINGS_LIMITS } from '../../../shared/tournament/view';
import {
  ApiError,
  type Decklist,
  errorText,
  fetchMyDecklist,
  type Registration,
  saveProfile,
  submitDecklist,
  withdrawDecklist
} from '../../lib/tournament/api';
import { latestValue } from '../../lib/resource';
import { DeckCombo } from '../live/LiveDeck';
import { ConfirmAction } from './ConfirmAction';
import { createDeckOptions } from './deckOptions';
import { ErrorLine } from './Field';
import { birthYearOf, emptyProfile, ProfileFields, profileProblems } from './ProfileFields';
import { session, setSession } from './session';

interface FormProps {
  code: string;
  archetypes: boolean;
  /** The event's format, whose archetypes the deck picker offers. */
  format: string;
  /** Unsanctioned, the form asks for the name alone. */
  sanctioned: boolean;
  /**
   * Whose list the signed-in account owns here, when it is a player: its POP
   * ID, or the full name of its Claim. A device that kept no list reads the
   * account's with it, and no token.
   */
  owner: ListOwner | null;
}

type ListOwner = Pick<PlayerProfile, 'popId' | 'firstName' | 'lastName'>;

/** Who sent this device's list, and the token that reads it back. */
interface Remembered {
  profile: PlayerProfile;
  token: string;
}

const memoryKey = (code: string) => `cm-decklist:${code}`;

function recall(code: string): Remembered | null {
  try {
    return JSON.parse(localStorage.getItem(memoryKey(code)) ?? 'null') as Remembered | null;
  } catch {
    return null;
  }
}

function remember(code: string, value: Remembered | null) {
  if (value) {
    localStorage.setItem(memoryKey(code), JSON.stringify(value));
  } else {
    localStorage.removeItem(memoryKey(code));
  }
}

/** This device's list, by the details and token it kept; on a device that kept none, the account's own. */
async function loadMine([code, owner]: readonly [string, ListOwner | null]): Promise<Decklist | null> {
  const kept = recall(code);
  if (kept) {
    return (await fetchMyDecklist(code, kept.profile, kept.token)).mine;
  }
  return owner ? (await fetchMyDecklist(code, owner, '')).mine : null;
}

const SECTION_LABELS: Record<DeckSection, string> = { pokemon: 'Pokémon', trainer: 'Trainer', energy: 'Energy' };

const submittedAt = (at: number) =>
  new Date(at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });

const REGISTRATION_WORDS: Record<Registration, (name: string) => string> = {
  added: () => 'Added you to the event',
  matched: name => `You're in the event as ${name}`,
  'not-added': () => 'Not added to the event'
};

/** Where the list stands, built from what the server said: sent when, and whether they are in the event. */
function statusLine(mine: Decklist | null, registration: Registration | null, count: string, problems: number) {
  if (!mine) {
    return `${count}${problems ? ` · ${problems} problem${problems === 1 ? '' : 's'}` : ''} · Not submitted`;
  }
  const name = `${mine.firstName} ${mine.lastName}`;
  const where = registration
    ? REGISTRATION_WORDS[registration](name)
    : mine.registered
      ? `You're in the event as ${name}`
      : 'Not on the player list yet';
  return `Submitted ${submittedAt(mine.submittedAt)} · ${where}`;
}

/** What is still missing before the list can go, for the one line under a disabled Submit. */
function missing(profile: PlayerProfile, deck: string, sanctioned: boolean): string | null {
  const problems = profileProblems(profile, sanctioned);
  const labels: Record<keyof PlayerProfile, string> = {
    popId: 'Player ID',
    firstName: 'first name',
    lastName: 'last name',
    birthDate: 'birth year'
  };
  const needed = (Object.keys(labels) as (keyof PlayerProfile)[]).filter(key => problems[key]).map(key => labels[key]);
  if (!deck.trim()) {
    needed.push('list');
  }
  if (needed.length === 0) {
    return null;
  }
  const last = needed.pop();
  return `Add your ${needed.length ? `${needed.join(', ')} and ${last}` : last}`;
}

/** The form's state and what it can do, apart from how it is drawn. */
function createDecklistForm(props: FormProps) {
  // eslint-disable-next-line solid/reactivity -- read once for the event the page opened on
  const kept = recall(props.code);
  // Read again only for another owner, not for every new copy of the event the props come from; a device's own list has none.
  const whose = createMemo(() => [props.code, kept ? null : props.owner] as const, undefined, {
    equals: (a, b) => a[0] === b[0] && a[1] === b[1]
  });
  const [mine, { mutate }] = createResource(whose, loadMine);
  const [profile, setProfile] = createSignal<PlayerProfile>(kept?.profile ?? emptyProfile(latestValue(session)?.user));
  const [known, setKnown] = createSignal(kept !== null);
  const [deck, setDeck] = createSignal('');
  const [archetype, setArchetype] = createSignal<string | null>(null);
  const [touched, setTouched] = createSignal(false);
  const [sending, setSending] = createSignal(false);
  const [registration, setRegistration] = createSignal<Registration | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const parsed = () => parseDecklist(deck());
  const current = () => latestValue(mine) ?? null;

  function fill(list: Decklist) {
    setDeck(list.deck);
    setArchetype(list.archetype);
    const { popId, firstName, lastName, birthDate } = list;
    setProfile({ popId, firstName, lastName, birthDate });
    setKnown(true);
  }
  /** Another owner's list is another player's: the form starts again from it, or from nothing. */
  function startAgain(list: Decklist | null) {
    setTouched(false);
    setRegistration(null);
    if (list) {
      fill(list);
    } else {
      setDeck('');
      setArchetype(null);
      setProfile(emptyProfile(latestValue(session)?.user));
      setKnown(false);
    }
  }
  // The list the device sent fills the form, until the player starts changing it; another owner's, once it is read.
  let filledFor = untrack(whose);
  createEffect(() => {
    const existing = current();
    const owner = whose();
    if (mine.state === 'ready' && owner !== filledFor) {
      filledFor = owner;
      startAgain(existing);
    } else if (existing && !touched()) {
      fill(existing);
    }
  });

  const edit = (apply: () => void) => {
    setTouched(true);
    apply();
  };
  const fail = (err: unknown) => setError(errorText(err));

  async function send() {
    setSending(true);
    setError(null);
    const before = recall(props.code);
    const sent = profile();
    // Kept before the list goes, so a list that lands without its answer is still this device's to change.
    const token = before?.token ?? crypto.randomUUID();
    remember(props.code, { profile: sent, token });
    try {
      const result = await submitDecklist(props.code, {
        deck: deck(),
        profile: sent,
        archetype: props.archetypes ? archetype() : null,
        token
      });
      remember(props.code, { profile: sent, token: result.token });
      setRegistration(result.registration);
      setKnown(true);
      setTouched(false);
      mutate(result.decklist);
    } catch (err) {
      // The server refused the list, so nothing landed: the device keeps what it had.
      if (err instanceof ApiError && err.status < 500) {
        remember(props.code, before);
      }
      fail(err);
    } finally {
      setSending(false);
    }
  }

  function clearList() {
    setDeck('');
    setArchetype(null);
    setRegistration(null);
    mutate(null);
  }

  // The list shown is the one withdrawn, whatever the fields above it say now.
  async function withdraw(list: Decklist) {
    setError(null);
    try {
      await withdrawDecklist(props.code, list, recall(props.code)?.token ?? null);
      clearList();
    } catch (err) {
      fail(err);
    }
  }

  // The account taking the list's POP ID, its name and birth year with it; refused when another account holds it.
  const [accountSaved, setAccountSaved] = createSignal(false);
  const [clash, setClash] = createSignal(false);
  async function saveToAccount() {
    setError(null);
    setClash(false);
    try {
      const { user } = await saveProfile(profile());
      setSession(prev => (prev ? { ...prev, user } : prev));
      setAccountSaved(true);
    } catch (err) {
      fail(err);
      setClash(err instanceof ApiError && err.body?.popIdTaken === true);
    }
  }
  /** Offered to a signed-in account whose POP ID is not the sent list's yet. */
  const offerSave = () => {
    const user = latestValue(session)?.user;
    return props.sanctioned && current() !== null && Boolean(user) && user?.popId !== profile().popId;
  };

  /** Someone else on this device: forget who sent the list, and start again. */
  function notYou() {
    remember(props.code, null);
    setKnown(false);
    setProfile(emptyProfile());
    setTouched(false);
    clearList();
  }

  return {
    current,
    profile,
    known,
    deck,
    archetype,
    touched,
    sending,
    registration,
    error,
    parsed,
    needs: () => missing(profile(), deck(), props.sanctioned),
    unchanged: () => current() !== null && !touched(),
    setProfile: (value: PlayerProfile) => edit(() => setProfile(value)),
    setDeck: (value: string) => edit(() => setDeck(value)),
    setArchetype: (value: string) => edit(() => setArchetype(value)),
    send,
    withdraw,
    notYou,
    offerSave,
    accountSaved,
    clash,
    saveToAccount
  };
}

type DecklistState = ReturnType<typeof createDecklistForm>;

/** Who is sending: the fields until the device knows, then the name with a way out. */
function YouRow(props: { form: DecklistState; sanctioned: boolean }) {
  const f = () => props.form;
  return (
    <div class='tm-box-bar tm-form-row'>
      <span class='tm-form-row-label'>You</span>
      <Show
        when={f().known() && f().current()}
        fallback={
          <ProfileFields
            idPrefix='deck'
            value={f().profile()}
            sanctioned={props.sanctioned}
            errors={f().touched() ? profileProblems(f().profile(), props.sanctioned) : {}}
            onChange={value => f().setProfile(value)}
          />
        }
      >
        <span class='tm-known'>
          <strong>
            {f().profile().firstName} {f().profile().lastName}
          </strong>
          <Show when={props.sanctioned}>
            <span class='muted tm-num'>
              {' '}
              · {f().profile().popId} · {birthYearOf(f().profile().birthDate)}
            </span>
          </Show>
          <Show when={f().offerSave()}>
            <button type='button' class='btn btn-secondary tm-small' onClick={() => void f().saveToAccount()}>
              Save to my account
            </button>
          </Show>
          <Show when={f().accountSaved() && !f().offerSave()}>
            <span class='muted' role='status'>
              Saved
            </span>
          </Show>
          <button type='button' class='btn btn-ghost tm-small' onClick={() => f().notYou()}>
            Not you?
          </button>
        </span>
      </Show>
    </div>
  );
}

/** The pasted list, with its count by section and anything wrong with it. */
function ListRow(props: { form: DecklistState }) {
  const parsed = () => props.form.parsed();
  const sections = () =>
    (Object.keys(SECTION_LABELS) as DeckSection[]).map(section => ({
      section,
      count: parsed()
        .cards.filter(card => card.section === section)
        .reduce((sum, card) => sum + card.count, 0)
    }));
  return (
    <div class='tm-box-bar tm-form-row'>
      <label class='tm-form-row-label' for='deck-list'>
        Decklist
      </label>
      <div class='tm-decklist-body'>
        <textarea
          id='deck-list'
          class='tm-input tm-textarea tm-decklist-input'
          placeholder='Paste your list from TCG Live'
          value={props.form.deck()}
          onInput={e => props.form.setDeck(e.currentTarget.value)}
        />
        <Show when={props.form.deck().trim()}>
          <p class='tm-deck-counts tm-num'>
            <For each={sections()}>
              {s => (
                <span>
                  {SECTION_LABELS[s.section]} <strong>{s.count}</strong>
                </span>
              )}
            </For>
            <span class='tm-grow' />
            <span classList={{ 'tm-problem': parsed().total !== 60 }}>
              <strong>{parsed().total}</strong> / 60
            </span>
          </p>
          <Show when={parsed().problems.length > 0} fallback={<p class='muted tm-deck-ok'>No problems</p>}>
            <ul class='tm-problems'>
              <For each={parsed().problems}>{problem => <li>{problem}</li>}</For>
            </ul>
          </Show>
        </Show>
      </div>
    </div>
  );
}

/** Submit (asking first when the list has problems), why it can't go yet, and Withdraw. */
function Foot(props: { form: DecklistState }) {
  const f = () => props.form;
  const problems = () => f().parsed().problems.length;
  const label = () => (f().current() ? 'Update decklist' : 'Submit decklist');
  const reason = () => f().needs() ?? (f().unchanged() ? 'No changes to send' : null);
  return (
    <div class='tm-box-bar tm-decklist-foot'>
      <Show
        when={problems() > 0 && !f().needs()}
        fallback={
          <button
            type='button'
            class='btn btn-primary'
            disabled={f().sending() || f().needs() !== null || f().unchanged()}
            onClick={() => void f().send()}
          >
            {label()}
          </button>
        }
      >
        <ConfirmAction
          class='btn btn-primary'
          label={label()}
          question={`Submit with ${problems()} problem${problems() === 1 ? '' : 's'}?`}
          confirmLabel='Submit'
          disabled={f().sending() || f().unchanged()}
          onConfirm={() => void f().send()}
        />
      </Show>
      <Show when={reason()}>{text => <span class='muted'>{text()}</span>}</Show>
      <span class='tm-grow' />
      <Show when={f().current()}>
        {list => (
          <ConfirmAction
            class='btn btn-ghost'
            label='Withdraw'
            question='Withdraw your decklist?'
            confirmLabel='Withdraw'
            danger
            onConfirm={() => void f().withdraw(list())}
          />
        )}
      </Show>
      <p class='tm-decklist-note muted'>
        {f().current()
          ? 'Change it from this device until submissions close.'
          : 'Staff see it. Change it until submissions close.'}
      </p>
    </div>
  );
}

export function DecklistForm(props: FormProps) {
  const form = createDecklistForm(props);
  const decks = createDeckOptions(() => props.format);
  const count = () => `${form.parsed().total} card${form.parsed().total === 1 ? '' : 's'}`;
  return (
    <form class='tm-box tm-decklist-form' onSubmit={event => event.preventDefault()}>
      <div class='tm-box-bar tm-decklist-status'>
        <strong>{statusLine(form.current(), form.registration(), count(), form.parsed().problems.length)}</strong>
      </div>
      <Show when={!form.known()}>
        <p class='tm-box-bar muted'>No account needed. Not registered yet? Submitting adds you.</p>
      </Show>
      <Show when={form.registration() === 'not-added'}>
        <p class='tm-box-bar muted'>List saved. Staff will need to add you.</p>
      </Show>
      <YouRow form={form} sanctioned={props.sanctioned} />
      <Show when={props.archetypes}>
        {/* A wrapping label, since the picker's input takes no id. */}
        <label class='tm-box-bar tm-form-row live-deck-picker'>
          <span class='tm-form-row-label'>Deck</span>
          <DeckCombo
            decks={decks()}
            selected={form.archetype() ? { label: form.archetype() as string } : undefined}
            placeholder='Search archetypes'
            custom={SETTINGS_LIMITS.archetype}
            onPick={picked => form.setArchetype(picked.label)}
          />
        </label>
      </Show>
      <ListRow form={form} />
      <Foot form={form} />
      <Show when={form.clash()} fallback={<ErrorLine message={form.error()} />}>
        <p class='tm-error' role='alert'>
          {form.error()}
          <span class='dot' aria-hidden='true'>
            {' · '}
          </span>
          <A class='tm-link-inline' href={`/feedback?from=/t/${props.code}`}>
            Feedback
          </A>
        </p>
      </Show>
    </form>
  );
}
