/**
 * /host/:code: running an event. Staff land here from their list or from an
 * invite link (`?invite=`), which adds them to the event's staff on the way in.
 */

import { divisionLookup } from '../../../shared/tournament/divisions';
import { A, useSearchParams } from '@solidjs/router';
import {
  createEffect,
  createMemo,
  createSignal,
  lazy,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
  untrack
} from 'solid-js';
import {
  activeIds,
  cutPodsOf,
  latestRound,
  livePods,
  roundComplete,
  wasFinalized
} from '../../../shared/tournament/rounds';

import { eventTypeOf } from '../../../shared/tournament/structure';
import type { Pod, PodCategory } from '../../../shared/tournament/types';
import { Segmented } from '../../components/Segmented';
import { Tabs } from '../../components/Tabs';
import { errorText, joinStaff, type Manage, saveSettings } from '../../lib/tournament/api';
import {
  clockLabel,
  type DivisionCut,
  divisionCuts,
  namesById,
  nextStep,
  type NextStep,
  plannedRounds,
  podLabel,
  type PodProgress,
  podProgress,
  shownDecks,
  statusParts,
  type SwissPlan,
  unseated
} from '../../lib/tournament/present';
import { session } from './session';
import { latestValue } from '../../lib/resource';
import { ConfirmAction } from './ConfirmAction';
import { ErrorLine } from './Field';
import { TournamentHero } from './Hero';
import { lookOnReturn, schedulePolls } from '../../lib/tournament/viewPoll';
import { createManage, type ManageState } from './manageState';
import { createNow } from './now';
import { TopCutControl } from './RoundControls';
import { RoundPanel } from './RoundPanel';
import { SignIn } from './SignIn';
import { createTomLink, type FileWrite, type TomLink, TomNextStep, TomStrip } from './TomSyncPanel';

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
const NO_PROGRESS: PodProgress = { round: undefined, tables: 0, open: 0, champion: null, label: '', next: '' };

/** What a TOM event's head adds to the round: whether TOM has every result entered here. */
function tomPart(tom: TomLink): string {
  if (tom.locked()) {
    return 'reconnect the .tdf to enter results';
  }
  const n = tom.pending();
  return n ? `${n} result${n === 1 ? '' : 's'} to write` : 'TOM has every result';
}

/**
 * A TOM event's next round, once every result of its latest is in: paired on
 * the site into TOM's file (see TomSyncPanel), and `planned` while the Swiss
 * rounds the attendance calls for are not all played. Round 1 and the top cut
 * start in TOM, which pods the field and sizes the cut, and a file TOM has
 * finalized takes no more rounds.
 */
function tomPairing(
  manage: Manage,
  pod: Pod | undefined,
  progress: PodProgress,
  plan: SwissPlan | null
): { pair: FileWrite | null; planned: boolean } {
  const step = nextStep(progress, manage.settings.finished, plan);
  const open = pod && progress.round && !wasFinalized(manage.tournament);
  const pair =
    open && (step.kind === 'pair' || step.kind === 'decide') && step.ready
      ? { kind: 'pair' as const, pod: pod.category, label: step.label }
      : null;
  return { pair, planned: step.kind === 'pair' };
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

/** Which of a Swiss round's ends the plan calls for: another round until its rounds are played, then the cut or the end. */
type RoundEnd = 'pair' | 'cut' | 'end';

/** What the disabled step says while the round plays, when it is not pairing. */
const WAITING_WORDS: Partial<Record<RoundEnd, string>> = { cut: 'Start top cut', end: 'End event' };

/**
 * The end of a Swiss round: another round, the top cut and ending the event,
 * together on one line and always in that order, so a hand finds each where
 * it was last round. Only the one the plan calls for is primary. While the
 * round is still playing, only that step shows, disabled, with the reason
 * under it.
 */
function RoundEndStep(props: {
  state: ManageState;
  manage: Manage;
  pod: Pod;
  label: string;
  ready: boolean;
  step: RoundEnd;
  cuts: readonly DivisionCut[];
  /** The pod's divisions have begun their top cuts: its Swiss rounds are over, and only the others' cuts are left. */
  swissOver: boolean;
  /** Another pod's round is still playing, so ending the event is not the step to take. */
  othersPlaying: boolean;
}) {
  const open = () => props.cuts.filter(c => !c.started);
  // A League Challenge plays Swiss rounds only.
  const canCut = () =>
    eventTypeOf(props.manage.tournament) === 'cup' && (props.step === 'cut' || open().some(c => c.active >= 4));
  return (
    <Show
      when={props.ready}
      fallback={
        <button type='button' class='btn btn-primary' disabled>
          {WAITING_WORDS[props.step] ?? props.label}
        </button>
      }
    >
      <span class='tm-next-acts'>
        <Show when={!props.swissOver}>
          <PairButton state={props.state} pod={props.pod} label={props.label} ready primary={props.step === 'pair'} />
        </Show>
        <Show when={canCut()}>
          <TopCutControl
            state={props.state}
            pod={props.pod}
            cuts={open()}
            divided={props.cuts.length > 1}
            primary={props.step === 'cut'}
          />
        </Show>
        <EndEvent state={props.state} manage={props.manage} primary={props.step === 'end' && !props.othersPlaying} />
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
  const swissOver = () => (props.pod ? cutPodsOf(props.manage.tournament, props.pod).length > 0 : false);
  // A division's bracket, or another pod paired apart, still playing: the event is not over for them.
  const othersPlaying = () =>
    livePods(props.manage.tournament).some(p => {
      const round = latestRound(p);
      return p.category !== props.pod?.category && round !== undefined && !roundComplete(round);
    });
  // The step's cut is the one the top cut control offers first: the last division's left to cut, Masters where it plays.
  const plan = () =>
    props.pod
      ? {
          rounds: plannedRounds(props.pod, props.manage.settings.roundCap, eventTypeOf(props.manage.tournament)),
          cut:
            cuts()
              .filter(c => !c.started)
              .at(-1)?.cut ?? 0
        }
      : null;
  const status = () => {
    const { tom } = props;
    const extra = tom
      ? [tomPart(tom)]
      : [...(waiting() ? [`${waiting()} not seated`] : []), ...(swissOver() ? ['top cuts under way'] : [])];
    const rounds = tom ? null : (plan()?.rounds ?? null);
    // A console that cannot reach the site says so, rather than showing an old round as the current one.
    const stale = props.state.loadError() ? ['not updating'] : [];
    return [...statusParts(progress(), finished(), clock(), rounds), ...extra, ...stale].join(' · ');
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
  /** The champion is known; a third-place match still playing holds the end back. */
  const closeStep = () => {
    const s = step();
    return s.kind === 'close' ? s : null;
  };
  /** A Swiss round's end, as RoundEndStep lays it out; round one and the top cut's rounds only pair. */
  const roundEnd = () => {
    const s = step();
    if (s.kind === 'decide' || (s.kind === 'pair' && swissOver() && cuts().some(c => !c.started && c.cut > 0))) {
      const cut = plan()?.cut ?? 0;
      return { ...s, end: (cut > 0 ? 'cut' : 'end') as RoundEnd };
    }
    return s.kind === 'pair' && progress().round?.kind === 'swiss' ? { ...s, end: 'pair' as RoundEnd } : null;
  };
  const firstBlocked = () => pairStep()?.label === 'Pair round 1' && active() < 2;
  const reason = () => (firstBlocked() ? 'Add players to pair' : (pairStep() ?? decideStep() ?? closeStep())?.reason);
  return (
    <TournamentHero
      title={props.manage.tournament.info.name}
      status={status()}
      meta={
        // Each part keeps the dot after it, so the line wraps between parts and never starts on a dot.
        <>
          <span class='tm-meta-part'>
            <span class='num'>{props.manage.code}</span>
            <span class='dot'>·</span>
          </span>
          <span class='tm-meta-part'>
            {props.manage.mode === 'tom' ? 'Run in TOM' : 'Swiss on this site'}
            <span class='dot'>·</span>
          </span>
          <span class='tm-meta-part'>
            {props.manage.tournament.players.length} players
            <span class='dot'>·</span>
          </span>
          <span class='tm-meta-part'>
            <A href={`/t/${props.manage.code}`}>Public page</A>
            <span class='dot'>·</span>
          </span>
          {/* Its own tab, since it goes on the projector while the console keeps running. */}
          <a href={`/t/${props.manage.code}?screen=1`} target='_blank' rel='noopener'>
            Big screen
          </a>
        </>
      }
      action={
        <Switch>
          <Match when={props.tom}>
            {tom => {
              const next = () => tomPairing(props.manage, swissOver() ? undefined : props.pod, progress(), plan());
              return <TomNextStep link={tom()} pair={next().pair} planned={next().planned} />;
            }}
          </Match>
          <Match when={props.pod && roundEnd()}>
            {s => (
              <RoundEndStep
                state={props.state}
                manage={props.manage}
                pod={props.pod as Pod}
                label={s().label}
                ready={s().ready}
                step={s().end}
                cuts={cuts()}
                swissOver={swissOver()}
                othersPlaying={othersPlaying()}
              />
            )}
          </Match>
          <Match when={pairStep()}>
            {s => (
              <PairButton state={props.state} pod={props.pod} label={s().label} ready={s().ready && !firstBlocked()} />
            )}
          </Match>
          <Match when={closeStep()}>
            {s => (
              <Show
                when={s().ready}
                fallback={
                  <button type='button' class='btn btn-primary' disabled>
                    End event
                  </button>
                }
              >
                <EndEvent state={props.state} manage={props.manage} primary={!othersPlaying()} />
              </Show>
            )}
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
  // Until one is picked, the first pod still in play: a pod whose divisions have cut has nothing left to pair.
  const pod = createMemo(
    () => pods().find(p => p.category === podChoice()) ?? livePods(props.manage.tournament)[0] ?? pods()[0]
  );
  const names = createMemo(() => namesById(props.manage.tournament));
  const divisionOf = createMemo(() => divisionLookup(props.manage.tournament));
  // A TOM event's file is linked for as long as the console is open, whatever the tab.
  const tom =
    // eslint-disable-next-line solid/reactivity -- an event's mode never changes, and the link lives as long as the console
    props.manage.mode === 'tom'
      ? createTomLink({
          manage: () => props.manage,
          onSynced: async answer => (answer ? props.state.take(answer) : props.state.load())
        })
      : null;
  return (
    <div class='tm-page'>
      <Hero state={props.state} manage={props.manage} pod={pod()} tom={tom} />
      <Tabs options={tabs()} selected={tab()} onSelect={setTab} ariaLabel='Event sections' />
      <Show when={tom}>{link => <TomStrip link={link()} />}</Show>
      <Show when={pods().length > 1 && (tab() === 'round' || tab() === 'standings')}>
        <Segmented
          options={pods().map(p => ({ value: p.category, label: podLabel(p) }))}
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
        <Show when={pod()}>
          {p => (
            <StandingsTable
              tournament={props.manage.tournament}
              pod={p()}
              names={names()}
              decks={shownDecks(props.manage)}
              divisionOf={divisionOf()}
              tiebreakers
              hideCutDecks={props.manage.settings.deckVisibility !== 'always' && !props.manage.settings.finished}
            />
          )}
        </Show>
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

  /** An invite link joins the staff first, which takes the account; the event is then read as staff. */
  async function join(code: string, invite: string) {
    await joinStaff(code, invite).catch(err => setJoinError(errorText(err)));
    await state.load();
  }

  // Without an invite the event is read at once, beside the account: the server says who may.
  createEffect(() => {
    const { code } = props;
    const { invite } = params;
    if (invite && !user()) {
      return;
    }
    // Untracked: the read looks at the copy it holds, and must not run again each time that copy changes.
    untrack(() => void (invite ? join(code, invite) : state.load()));
  });

  onMount(() => {
    // One look at a time, waiting longer after each that fails, and at once when the tab is back in view.
    const polls = schedulePolls(
      () => (state.data() && !state.busy() ? state.load() : Promise.resolve(true)),
      () => document.hidden,
      REFRESH_MS
    );
    const forget = lookOnReturn(polls);
    onCleanup(() => {
      polls.stop();
      forget();
    });
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
