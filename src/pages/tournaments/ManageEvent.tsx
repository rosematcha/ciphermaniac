/**
 * /host/:code: running an event. Staff land here from their list or from an
 * invite link (`?invite=`), which adds them to the event's staff on the way in.
 */

import { divisionLookup } from '../../../shared/tournament/divisions';
import { A, useSearchParams } from '@solidjs/router';
import { createEffect, createMemo, createSignal, For, lazy, Match, onCleanup, onMount, Show, Switch } from 'solid-js';
import { activeIds } from '../../../shared/tournament/rounds';
import { type Pod, POD_LABELS, type PodCategory } from '../../../shared/tournament/types';
import { Segmented } from '../../components/Segmented';
import { Tabs } from '../../components/Tabs';
import { joinStaff, type Manage, saveSettings } from '../../lib/tournament/api';
import {
  clockLabel,
  type DivisionCut,
  divisionCuts,
  namesById,
  nextStep,
  type NextStep,
  plannedRounds,
  type PodProgress,
  podProgress,
  shownDecks,
  statusParts,
  unseated
} from '../../lib/tournament/present';
import { session } from './session';
import { latestValue } from '../../lib/resource';
import { ConfirmAction } from './ConfirmAction';
import { ErrorLine } from './Field';
import { TournamentHero } from './Hero';
import { createManage, type ManageState } from './manageState';
import { createNow } from './now';
import { TopCutControl } from './RoundControls';
import { RoundPanel } from './RoundPanel';
import { SignIn } from './SignIn';
import { createTomLink, type TomLink, TomNextStep, TomStrip } from './TomSyncPanel';

// Pairings is the tab a running event lives on, so only it loads with the page;
// the others load when opened (decklists are read before the event, the
// players and event tabs mostly before it too, standings between rounds).
const DecklistsPanel = lazy(() => import('./DecklistsPanel').then(m => ({ default: m.DecklistsPanel })));
const PlayersPanel = lazy(() => import('./PlayersPanel').then(m => ({ default: m.PlayersPanel })));
const StandingsTable = lazy(() => import('./StandingsTable').then(m => ({ default: m.StandingsTable })));
const EventPanel = lazy(() => import('./EventPanel').then(m => ({ default: m.EventPanel })));

type Tab = 'round' | 'players' | 'standings' | 'decklists' | 'event';

const TABS: { value: Tab; label: string }[] = [
  { value: 'round', label: 'Pairings' },
  { value: 'players', label: 'Players' },
  { value: 'standings', label: 'Standings' },
  { value: 'decklists', label: 'Decklists' },
  { value: 'event', label: 'Event' }
];

/** Other staff change the event too; the console looks again this often while visible. */
const REFRESH_MS = 15_000;

/** A division with no pod yet: nothing paired, nothing playing. */
const NO_PROGRESS: PodProgress = { round: undefined, tables: 0, open: 0, champion: null };

/** What a TOM event's head adds to the round: whether TOM has every result entered here. */
function tomPart(tom: TomLink): string {
  if (tom.locked()) {
    return 'reconnect the .tdf to enter results';
  }
  const n = tom.pending();
  return n ? `${n} result${n === 1 ? '' : 's'} to write` : 'TOM has every result';
}

/** Pairing the pod's next round or stage. */
function PairButton(props: {
  state: ManageState;
  pod: Pod | undefined;
  label: string;
  ready: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type='button'
      class={props.primary === false ? 'btn btn-secondary' : 'btn btn-primary'}
      disabled={!props.ready || props.state.busy()}
      onClick={() => props.pod && void props.state.send({ type: 'pairRound', pod: props.pod.category })}
    >
      {props.label}
    </button>
  );
}

/** Ending the event, asked in place. */
function EndEvent(props: { state: ManageState; manage: Manage; primary?: boolean }) {
  function end() {
    const { code } = props.manage;
    void props.state.run(() => saveSettings(code, { finished: true }));
  }
  return (
    <ConfirmAction
      class={props.primary ? 'btn btn-primary' : 'btn btn-secondary'}
      label='End event'
      question='End the event?'
      confirmLabel='End event'
      disabled={props.state.busy()}
      onConfirm={end}
    />
  );
}

/**
 * Once the plan's Swiss rounds are played: the top cut when the plan has one,
 * else ending the event, as the step, with another round and the other of
 * the two beside it. While the last round is still playing, only the step
 * shows, disabled, with the reason under it.
 */
function DecideStep(props: {
  state: ManageState;
  manage: Manage;
  pod: Pod;
  step: Extract<NextStep, { kind: 'decide' }>;
  cuts: readonly DivisionCut[];
}) {
  const cutFirst = () => props.step.cut > 0;
  const cut = (primary: boolean) => (
    <TopCutControl state={props.state} pod={props.pod} cuts={props.cuts} primary={primary} />
  );
  return (
    <Show
      when={props.step.ready}
      fallback={
        <button type='button' class='btn btn-primary' disabled>
          {cutFirst() ? 'Start top cut' : 'End event'}
        </button>
      }
    >
      <span class='tm-next-acts'>
        <PairButton state={props.state} pod={props.pod} label={props.step.label} ready primary={false} />
        <Show
          when={cutFirst()}
          fallback={
            <>
              <Show when={props.cuts.some(c => c.active >= 4)}>{cut(false)}</Show>
              <EndEvent state={props.state} manage={props.manage} primary />
            </>
          }
        >
          <EndEvent state={props.state} manage={props.manage} />
          {cut(true)}
        </Show>
      </span>
    </Show>
  );
}

/**
 * The console's head, the same on every tab: the event, where its round
 * stands, and the step to take next. A TOM event's next step belongs to
 * its file: reconnect it, write the results TOM does not have, or read it
 * again (see TomSyncPanel).
 */
function Hero(props: { state: ManageState; manage: Manage; pod: Pod | undefined; tom: TomLink | null }) {
  const now = createNow();
  const finished = () => props.manage.settings.finished;
  const progress = () => (props.pod ? podProgress(props.pod, props.manage.pending) : NO_PROGRESS);
  const clock = () => {
    const { round } = progress();
    return round && (round.clockStartedAt != null || round.startTime) ? clockLabel(round, now()) : null;
  };
  const waiting = () =>
    props.manage.mode === 'swiss' && props.pod ? unseated(props.manage.tournament, props.pod).length : 0;
  const active = () => (props.pod ? activeIds(props.manage.tournament, props.pod).length : 0);
  const cuts = createMemo(() =>
    props.pod ? divisionCuts(props.manage.tournament, props.pod, divisionLookup(props.manage.tournament)) : []
  );
  // The step's cut is the one the top cut control offers first: the last division's, Masters where it plays.
  const plan = () =>
    props.pod
      ? { rounds: plannedRounds(props.pod, props.manage.settings.roundCap), cut: cuts().at(-1)?.cut ?? 0 }
      : null;
  const status = () => {
    const { tom } = props;
    const extra = tom ? [tomPart(tom)] : waiting() ? [`${waiting()} not seated`] : [];
    const rounds = tom ? null : (plan()?.rounds ?? null);
    return [...statusParts(progress(), finished(), tom ? null : clock(), rounds), ...extra].join(' · ');
  };
  const step = () => (props.tom ? ({ kind: 'none' } as NextStep) : nextStep(progress(), finished(), plan()));
  const pairStep = () => {
    const s = step();
    return s.kind === 'pair' ? s : null;
  };
  const decideStep = () => {
    const s = step();
    return s.kind === 'decide' ? s : null;
  };
  const firstBlocked = () => pairStep()?.label === 'Pair round 1' && active() < 2;
  const reason = () => (firstBlocked() ? 'Add players to pair' : (pairStep() ?? decideStep())?.reason);
  return (
    <TournamentHero
      title={props.manage.tournament.info.name}
      status={status()}
      meta={
        <>
          <span class='num'>{props.manage.code}</span>
          <span class='dot'>·</span>
          {props.manage.mode === 'tom' ? 'Run in TOM' : 'Swiss on this site'}
          <span class='dot'>·</span>
          {props.manage.tournament.players.length} players
          <span class='dot'>·</span>
          <A href={`/t/${props.manage.code}`}>Public page</A>
          <span class='dot'>·</span>
          {/* Its own tab, since it goes on the projector while the console keeps running. */}
          <a href={`/t/${props.manage.code}?screen=1`} target='_blank' rel='noopener'>
            Big screen
          </a>
        </>
      }
      action={
        <Switch>
          <Match when={props.tom}>{tom => <TomNextStep link={tom()} />}</Match>
          <Match when={pairStep()}>
            {s => (
              <PairButton state={props.state} pod={props.pod} label={s().label} ready={s().ready && !firstBlocked()} />
            )}
          </Match>
          <Match when={props.pod && decideStep()}>
            {s => (
              <DecideStep state={props.state} manage={props.manage} pod={props.pod as Pod} step={s()} cuts={cuts()} />
            )}
          </Match>
          <Match when={step().kind === 'close'}>
            <EndEvent state={props.state} manage={props.manage} primary />
          </Match>
        </Switch>
      }
      reason={reason()}
    />
  );
}

/** The console's tabs: Decklists only while the event takes them. */
const tabsFor = (manage: Manage) => TABS.filter(t => t.value !== 'decklists' || manage.settings.decklists !== 'off');

function Console(props: { state: ReturnType<typeof createManage>; manage: Manage }) {
  // In the URL, so a reload mid-event comes back to the same tab.
  const [params, setParams] = useSearchParams<{ tab?: string }>();
  const tabs = () => tabsFor(props.manage);
  const tab = (): Tab => (tabs().some(t => t.value === params.tab) ? (params.tab as Tab) : 'round');
  const setTab = (value: Tab) => setParams({ tab: value === 'round' ? undefined : value }, { replace: true });
  const [podChoice, setPodChoice] = createSignal<PodCategory | null>(null);
  const pods = () => props.manage.tournament.pods;
  const pod = createMemo(() => pods().find(p => p.category === podChoice()) ?? pods()[0]);
  const names = createMemo(() => namesById(props.manage.tournament));
  const divisionOf = createMemo(() => divisionLookup(props.manage.tournament));
  // A TOM event's file is linked for as long as the console is open, whatever the tab.
  const tom =
    // eslint-disable-next-line solid/reactivity -- an event's mode never changes, and the link lives as long as the console
    props.manage.mode === 'tom'
      ? createTomLink({ manage: () => props.manage, onSynced: () => props.state.load() })
      : null;
  return (
    <div class='tm-page'>
      <Hero state={props.state} manage={props.manage} pod={pod()} tom={tom} />
      <Tabs options={tabs()} selected={tab()} onSelect={setTab} ariaLabel='Event sections' />
      <Show when={tom}>{link => <TomStrip link={link()} />}</Show>
      <Show when={pods().length > 1 && (tab() === 'round' || tab() === 'standings')}>
        <Segmented
          options={pods().map(p => ({ value: p.category, label: POD_LABELS[p.category] }))}
          selected={pod()?.category ?? 'masters'}
          onSelect={setPodChoice}
          ariaLabel='Division'
        />
      </Show>
      <ErrorLine message={props.state.error()} />
      <Show when={tab() === 'round'}>
        <Show when={pod()} fallback={<p class='muted'>Add players to start pairing.</p>}>
          {p => <RoundPanel state={props.state} manage={props.manage} pod={p()} locked={tom?.locked() ?? false} />}
        </Show>
      </Show>
      <Show when={tab() === 'players'}>
        <PlayersPanel state={props.state} manage={props.manage} />
      </Show>
      <Show when={tab() === 'standings'}>
        <For each={pod() ? [pod()!] : []}>
          {p => (
            <StandingsTable
              tournament={props.manage.tournament}
              pod={p}
              names={names()}
              decks={shownDecks(props.manage)}
              divisionOf={divisionOf()}
              tiebreakers
              hideCutDecks={props.manage.settings.deckVisibility !== 'always' && !props.manage.settings.finished}
            />
          )}
        </For>
      </Show>
      <Show when={tab() === 'decklists'}>
        <DecklistsPanel state={props.state} manage={props.manage} />
      </Show>
      <Show when={tab() === 'event'}>
        <EventPanel state={props.state} manage={props.manage} />
      </Show>
    </div>
  );
}

/**
 * Why the console did not open, and who asked: a refusal is almost always the
 * wrong account, so switching is one press away.
 */
function Refused(props: { message: string | undefined; name: string | undefined }) {
  return (
    <Show when={props.message}>
      <ErrorLine message={props.message} />
      <p class='muted'>
        Signed in as {props.name}. <A href='/settings'>Switch account in Settings</A>
      </p>
    </Show>
  );
}

export function ManageEvent(props: { code: string }) {
  const [params] = useSearchParams<{ invite?: string }>();
  const state = createManage(() => props.code);
  const [joinError, setJoinError] = createSignal<string | null>(null);
  const user = () => latestValue(session)?.user;

  async function enter(code: string, invite: string | undefined) {
    if (invite) {
      await joinStaff(code, invite).catch(err => setJoinError(err instanceof Error ? err.message : String(err)));
    }
    await state.load();
  }

  createEffect(() => {
    if (user()) {
      void enter(props.code, params.invite);
    }
  });

  onMount(() => {
    const timer = setInterval(() => {
      if (!document.hidden && state.data() && !state.busy()) {
        void state.load();
      }
    }, REFRESH_MS);
    onCleanup(() => clearInterval(timer));
  });

  createEffect(() => {
    document.title = `${state.data()?.tournament.info.name ?? props.code} — Run an event — Ciphermaniac`;
  });

  return (
    <Show
      when={user()}
      fallback={
        <Show when={latestValue(session)}>
          {s => (
            <SignIn
              providers={s().providers}
              next={`/host/${props.code}${params.invite ? `?invite=${params.invite}` : ''}`}
            />
          )}
        </Show>
      }
    >
      <ErrorLine message={joinError()} />
      <Show when={state.data()} fallback={<Refused message={state.loadError()?.message} name={user()?.name} />}>
        {manage => <Console state={state} manage={manage()} />}
      </Show>
    </Show>
  );
}
