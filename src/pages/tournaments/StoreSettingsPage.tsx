/**
 * /stores/:id/settings: a store's Managers change it. The sections are
 * listed down the left, as a settings app lists them, and the chosen one
 * fills the right (`?section=`, so each can be linked to): League nights (the
 * weekly nights and the dates that differ), Staff (StoreStaff), and Details
 * (what the store tells players). On a phone the list becomes a row of
 * tabs over the section. Staff who are not Managers are sent to the store's
 * page; signed out, one box to sign in.
 */

import { A, useSearchParams } from '@solidjs/router';
import { createEffect, createResource, createSignal, For, Match, Show, Switch, untrack } from 'solid-js';
import {
  dateIn,
  type LeagueNight,
  managesStore,
  type NightException,
  type StoreDetails
} from '../../../shared/accounts/stores';
import type { PublicStore } from '../../../shared/accounts/types';
import { Skeleton } from '../../components/Skeleton';
import { errorText, type SignInOffer } from '../../lib/tournament/api';
import {
  byWeek,
  cleanDetails,
  detailsProblems,
  fetchStore,
  saveLeagueNights,
  saveStoreDetails
} from '../../lib/tournament/stores';
import { latestValue } from '../../lib/resource';
import { ErrorLine } from './Field';
import { TournamentHero } from './Hero';
import { NightExceptions, WeeklyNights } from './LeagueNights';
import { refreshSession, session } from './session';
import { SignIn } from './SignIn';
import { StoreFields } from './StoreFields';
import { StoreStaff } from './StoreStaff';
import '../../styles/pages/tournament-store-settings.css';

type Section = 'nights' | 'staff' | 'details';

const SECTIONS: { value: Section; label: string }[] = [
  { value: 'nights', label: 'League nights' },
  { value: 'staff', label: 'Staff' },
  { value: 'details', label: 'Details' }
];

const readSection = (value: string | undefined): Section =>
  SECTIONS.find(section => section.value === value)?.value ?? 'nights';

/** Save at the foot of a section: what it is waiting on, the error, or that it saved. */
function SaveBar(props: {
  dirty: boolean;
  busy: boolean;
  saved: boolean;
  error: string | null;
  reason?: string | null;
}) {
  return (
    <div class='tm-store-save'>
      <button type='submit' class='btn btn-primary' disabled={!props.dirty || props.busy || Boolean(props.reason)}>
        Save
      </button>
      <Show when={props.reason && props.dirty}>
        <span class='muted'>{props.reason}</span>
      </Show>
      <Show when={props.saved && !props.dirty}>
        <span class='muted' role='status'>
          Saved
        </span>
      </Show>
      <ErrorLine message={props.error} />
    </div>
  );
}

/** One save of a section: busy while it goes, the error it left, and whether the last one landed. */
function createSave() {
  const [busy, setBusy] = createSignal(false);
  const [saved, setSaved] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  async function run(step: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await step();
      setSaved(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  return { busy, saved, error, run };
}

const nightsProblem = (nights: readonly LeagueNight[], exceptions: readonly NightException[]) => {
  if (nights.some(night => !night.time)) {
    return 'Give each league night a start time';
  }
  return exceptions.some(item => !item.date || item.time === '')
    ? 'Give each date a day, and a time if it moved'
    : null;
};

function NightsSection(props: { store: PublicStore; onSaved: (store: PublicStore) => void }) {
  // Edits of a copy of the nights the page opened with, until they are saved.
  const [nights, setNights] = createSignal<LeagueNight[]>(untrack(() => byWeek(props.store.nights)));
  const [exceptions, setExceptions] = createSignal<NightException[]>(untrack(() => [...props.store.exceptions]));
  const save = createSave();
  const dirty = () =>
    JSON.stringify([nights(), exceptions()]) !== JSON.stringify([byWeek(props.store.nights), props.store.exceptions]);
  const today = () => dateIn(props.store.timeZone, Date.now());
  /** A date that named a night now removed applies to every night that day, rather than to none the server knows. */
  function changeNights(next: LeagueNight[]) {
    const kept = new Set(next.map(night => night.id));
    setNights(next);
    setExceptions(prev =>
      prev.map(item => (item.nightId !== null && !kept.has(item.nightId) ? { ...item, nightId: null } : item))
    );
  }
  function submit(event: Event) {
    event.preventDefault();
    const { store, onSaved } = props;
    const asked = { nights: nights(), exceptions: exceptions() };
    void save.run(async () => {
      const result = await saveLeagueNights(store.id, asked.nights, asked.exceptions);
      setNights(byWeek(result.nights));
      setExceptions(result.exceptions);
      onSaved({ ...store, nights: result.nights, exceptions: result.exceptions });
    });
  }
  return (
    <form class='tm-store-section' aria-labelledby='store-nights-head' onSubmit={submit}>
      <h2 class='tm-subhead tm-box-head' id='store-nights-head'>
        Every week
      </h2>
      <div class='tm-box tm-store-pane'>
        <WeeklyNights
          nights={nights()}
          country={props.store.country}
          storeName={props.store.name}
          onChange={changeNights}
        />
      </div>
      <h2 class='tm-subhead tm-box-head'>Dates that differ</h2>
      <div class='tm-box tm-store-pane'>
        <NightExceptions exceptions={exceptions()} nights={nights()} today={today()} onChange={setExceptions} />
      </div>
      <SaveBar
        dirty={dirty()}
        busy={save.busy()}
        saved={save.saved()}
        error={save.error()}
        reason={nightsProblem(nights(), exceptions())}
      />
    </form>
  );
}

function DetailsSection(props: {
  store: PublicStore;
  contact: { phone: string; email: string };
  onSaved: (store: PublicStore, contact: { phone: string; email: string }) => void;
}) {
  const opened = (): StoreDetails => {
    const { name, address, city, region, postal, country, website, discord, details } = props.store;
    return { name, address, city, region, postal, country, website, discord, details, ...props.contact };
  };
  const [details, setDetails] = createSignal(untrack(opened));
  const [timeZone, setTimeZone] = createSignal(untrack(() => props.store.timeZone));
  const [checked, setChecked] = createSignal(false);
  const save = createSave();
  const dirty = () =>
    timeZone() !== props.store.timeZone || JSON.stringify(cleanDetails(details())) !== JSON.stringify(opened());
  function submit(event: Event) {
    event.preventDefault();
    setChecked(true);
    if (Object.keys(detailsProblems(details())).length > 0) {
      return;
    }
    const { store: opening, onSaved } = props;
    const { lat, lon } = opening;
    const zone = timeZone();
    const change = {
      details: cleanDetails(details()),
      timeZone: zone,
      place: lat !== null && lon !== null ? { lat, lon, timeZone: zone } : null
    };
    void save.run(async () => {
      const { store } = await saveStoreDetails(opening.id, change);
      const { phone, email, ...shown } = store;
      onSaved({ ...opening, ...shown }, { phone, email });
      // The store's name is in the account's own list of stores too.
      void refreshSession();
    });
  }
  return (
    <form class='tm-store-section' aria-labelledby='store-details-head' noValidate onSubmit={submit}>
      <h2 class='tm-subhead tm-box-head' id='store-details-head'>
        Details
      </h2>
      <div class='tm-box tm-store-pane'>
        <StoreFields
          id='store-field'
          details={details()}
          timeZone={timeZone()}
          checked={checked()}
          onChange={setDetails}
          onTimeZone={setTimeZone}
        />
      </div>
      <SaveBar dirty={dirty()} busy={save.busy()} saved={save.saved()} error={save.error()} />
    </form>
  );
}

/** The section list: down the left on a wide screen, a row of tabs on a phone. */
function SectionNav(props: { current: Section; onPick: (section: Section) => void }) {
  return (
    <nav class='tm-store-nav' aria-label='Store settings'>
      <For each={SECTIONS}>
        {section => (
          <button
            type='button'
            classList={{ 'is-on': props.current === section.value }}
            aria-current={props.current === section.value ? 'page' : undefined}
            onClick={() => props.onPick(section.value)}
          >
            {section.label}
          </button>
        )}
      </For>
    </nav>
  );
}

function Settings(props: { id: string }) {
  const [params, setParams] = useSearchParams<{ section?: string }>();
  const [read, { mutate }] = createResource(() => props.id, fetchStore);
  const current = () => latestValue(read);
  const section = () => readSection(params.section);
  createEffect(() => {
    const name = current()?.store.name;
    document.title = `${name ? `${name} settings` : 'Store settings'} — Ciphermaniac`;
  });
  const saved = (store: PublicStore, contact?: { phone: string; email: string }) =>
    mutate(prev => prev && { ...prev, store, ...(contact ? { contact } : {}) });
  return (
    <Show
      when={current()}
      fallback={
        <Show when={read.error} fallback={<Skeleton height='240px' />}>
          <ErrorLine message={errorText(read.error)} />
        </Show>
      }
    >
      {answer => (
        <Show
          when={managesStore(answer().role)}
          fallback={
            <>
              <TournamentHero title={answer().store.name} />
              <p class='tm-store-refused'>
                <span>Only this store’s managers can change it.</span>{' '}
                <A href={`/stores/${answer().store.id}`}>Store page</A>
              </p>
            </>
          }
        >
          <TournamentHero
            title={answer().store.name}
            meta={
              <>
                <span class='tm-num'>League {answer().store.leagueId}</span>
                <span class='tm-store-dot' aria-hidden='true'>
                  ·
                </span>
                <A href={`/stores/${answer().store.id}`}>Store page</A>
              </>
            }
            action={
              <A class='btn btn-primary' href={`/host?${new URLSearchParams({ new: answer().store.id }).toString()}`}>
                Start an event
              </A>
            }
          />
          <div class='tm-store-settings'>
            <SectionNav current={section()} onPick={value => setParams({ section: value })} />
            <div class='tm-store-content'>
              <Switch>
                <Match when={section() === 'nights'}>
                  <NightsSection store={answer().store} onSaved={store => saved(store)} />
                </Match>
                <Match when={section() === 'staff'}>
                  <StoreStaff storeId={answer().store.id} />
                </Match>
                <Match when={section() === 'details'}>
                  <DetailsSection
                    store={answer().store}
                    contact={answer().contact ?? { phone: '', email: '' }}
                    onSaved={saved}
                  />
                </Match>
              </Switch>
            </div>
          </div>
        </Show>
      )}
    </Show>
  );
}

function SignedOut(props: { offer: SignInOffer; id: string }) {
  return (
    <>
      <TournamentHero title='Store settings' />
      <section class='tm-box'>
        <div class='tm-box-bar'>
          <SignIn offer={props.offer} next={`/stores/${props.id}/settings`} />
        </div>
      </section>
    </>
  );
}

export function StoreSettingsPage(props: { id: string }) {
  return (
    <div class='tm-page tm-store-settings-page'>
      <Show when={latestValue(session)}>
        {s => (
          <Show when={s().user} fallback={<SignedOut offer={s()} id={props.id} />}>
            <Settings id={props.id} />
          </Show>
        )}
      </Show>
    </div>
  );
}
