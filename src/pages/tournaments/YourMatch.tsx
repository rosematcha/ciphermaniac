/**
 * The viewer's own match on the public page, in two sizes. The strip says
 * where they sit and against whom, with the clock; where players report,
 * Report result opens it into the panel of answers. The button they pressed
 * is the state: accented once reported, marked when the opponent says
 * otherwise, and fixed once the result stands. A report can change until it
 * locks (see shared/tournament/reports.ts). Before round 1 the strip says
 * they are registered; once the event ends, where they placed.
 *
 * The viewer says who they are once (see Identify), and the device
 * remembers it; the page holds that (see PublicEvent). A signed-in account
 * that is the player is not asked: by its POP ID at a sanctioned event, or
 * by its Claim at an unsanctioned one, which it can undo from here. A
 * signed-out player is offered sign-in under the question.
 */

import { ordinal } from '../../lib/format';
import { createEffect, createSignal, For, lazy, Match, Show, Suspense, Switch } from 'solid-js';
import type { PlayerClaim } from '../../../shared/tournament/identify';
import type { PlayerResult } from '../../../shared/tournament/reports';
import { recordLabel, sideResult } from '../../../shared/tournament/standings';
import { hasStarted, podOf, withSwiss } from '../../../shared/tournament/rounds';
import type { Pod, Round, Match as TableMatch } from '../../../shared/tournament/types';
import { isSanctioned, type PublishedView, type TournamentView } from '../../../shared/tournament/view';
import { ApiError, errorText, identifyPlayer, type Provider, reportAsPlayer } from '../../lib/tournament/api';
import {
  currentMatchOf,
  divisionHeading,
  namesById,
  podStandings,
  recordsBefore,
  reportState,
  shownOutcome
} from '../../lib/tournament/present';
import { Clock } from './Clock';
import { ConfirmAction } from './ConfirmAction';
import { ErrorLine } from './Field';
import { type Identified, IdentifyForm } from './Identify';
import { createNow } from './now';

// Loaded on asking: most players never sign in from here, and Settings has these already.
const SignIn = lazy(() => import('./SignIn').then(m => ({ default: m.SignIn })));

const SAID: Record<PlayerResult, string> = { win: 'won', loss: 'lost', tie: 'tied' };

const NOT_REPORTER = 'Someone else is already reporting for this player. Ask staff if that’s wrong.';

const NOTES = {
  open: 'You and your opponent both report. When the two reports match, the result counts.',
  reported: 'You can change your report until the timer runs out. After that it waits for your opponent’s.',
  disputed: 'Your reports don’t match. If you pressed the wrong one, change it. Otherwise, find a judge.',
  /** Once the report is locked there is nothing to change: only the judge is left. */
  disputedLocked: 'Your reports don’t match. Find a judge.'
};

interface Props {
  view: TournamentView;
  /** The viewer's player, once they have said who they are. */
  me: string | null;
  /** What they said, which reports carry; null until they say. */
  claim: PlayerClaim | null;
  /** The token of the device that reports for them, when this device is it. */
  reportToken: string | null;
  /** Whether they report from here: this device holds the token, or their account holds the seat. */
  reports: boolean;
  onIdentified: (found: Identified) => void;
  onForget: () => void;
  onView: (view: PublishedView) => void;
  onPlayer?: (id: string) => void;
  /** The start of round 1, formatted, or null when unset. */
  firstRound: string | null;
  /** Whether an account is signed in, which the page's copy of the event cannot say until the API answers. */
  signedIn: boolean;
  /** The sign-ins the server offers, for a player who is signed out. */
  providers: readonly Provider[];
  /** Ends the signed-in account's Claim on the player, then forgets it on this device. */
  onUnlink: () => Promise<void>;
  /** Asks the server again who the viewer is: a report was refused, so who the page thinks they are may be out of date. */
  onStale: () => void;
}

interface Found {
  pod: Pod;
  round: Round;
  match: TableMatch;
}

/** Sign-in, asked for in place: a link until pressed, then the providers, coming back to the event. */
function SignInHere(props: { code: string; providers: readonly Provider[] }) {
  const [open, setOpen] = createSignal(false);
  return (
    <Show
      when={open()}
      fallback={
        <button type='button' class='tm-link-inline tm-you-signin' onClick={() => setOpen(true)}>
          Sign in
        </button>
      }
    >
      <Suspense>
        <SignIn providers={props.providers} next={`/t/${props.code}`} />
      </Suspense>
    </Show>
  );
}

/** "Which player are you?", where players report and a round is on. */
function WhichPlayer(props: Props) {
  const sanctioned = () => isSanctioned(props.view);
  return (
    <section class='tm-box tm-you tm-you-ask' aria-label='Your match'>
      <h2 class='tm-you-q'>Which player are you?</h2>
      <IdentifyForm view={props.view} idPrefix='report' submitLabel='Find my match' onFound={props.onIdentified} />
      <p class='tm-you-note muted'>
        Enter your {sanctioned() ? 'Player ID' : 'last name'} to see your table and report your result. This phone will
        remember you.
      </p>
      <Show when={!props.signedIn}>
        <SignInHere code={props.view.code} providers={props.providers} />
      </Show>
    </section>
  );
}

const CHOICES: { result: PlayerResult; label: string }[] = [
  { result: 'win', label: 'I won' },
  { result: 'loss', label: 'I lost' },
  { result: 'tie', label: 'Tie' }
];

/** The viewer's report of their match: where it stands, sending it, and settling it once both agree. */
function createReport(props: Props & { me: string }, found: () => Found | null) {
  const now = createNow();
  /** The answer on its way to the server: its button reads as pressed from the press, not from the reply. */
  const [sending, setSending] = createSignal<PlayerResult | null>(null);
  const busy = () => sending() !== null;
  const [error, setError] = createSignal<string | null>(null);
  const [settling, setSettling] = createSignal(false);
  const state = () => {
    const f = found();
    return props.claim && f && f.match.p2 !== null
      ? reportState(f, { pending: props.view.pending, reports: props.view.reports ?? [] }, props.me, now())
      : null;
  };

  async function send(result: PlayerResult) {
    const { claim } = props;
    const shown = found();
    if (!claim || !shown) {
      return;
    }
    const match = { pod: shown.pod.category, round: shown.round.number, table: shown.match.table };
    setSending(result);
    setError(null);
    try {
      props.onView((await reportAsPlayer(props.view.code, claim, { result, match }, props.reportToken)).view);
    } catch (err) {
      setError(errorText(err));
      // Not theirs to report (released, or linked elsewhere since), or the event moved on.
      if (err instanceof ApiError && (err.status === 403 || err.status === 409)) {
        props.onStale();
      }
    } finally {
      setSending(null);
    }
  }

  async function settle(claim: PlayerClaim) {
    setSettling(true);
    const answer = await identifyPlayer(props.view.code, claim, props.reportToken).catch(() => null);
    if (answer) {
      props.onView(answer.view);
    }
    // Clocks differ by a second or two; if the server did not settle it yet, ask again shortly.
    setTimeout(() => setSettling(false), 5000);
  }

  // Once both reports agree and lock, asking again writes the result in, so it shows as it stands.
  createEffect(() => {
    const { claim } = props;
    if (claim && state()?.due && !settling()) {
      void settle(claim);
    }
  });

  return { state, busy, sending, error, send };
}

type Report = ReturnType<typeof createReport>;

/** The answers, what the report is waiting on, and the line that explains it. */
function ReportPanel(props: { report: Report; found: Found; opponent: string }) {
  const s = () => props.report.state();
  const choices = () => (props.found.round.kind === 'elimination' ? CHOICES.filter(c => c.result !== 'tie') : CHOICES);
  const status = () => {
    const state = s();
    if (!state?.chosen) {
      return 'Not reported';
    }
    if (state.disputed) {
      return 'Reports don’t match';
    }
    return state.locked ? 'Report locked' : `Waiting on ${props.opponent}`;
  };
  const note = () => {
    const state = s();
    if (!state?.chosen) {
      return NOTES.open;
    }
    if (state.disputed) {
      return state.locked ? NOTES.disputedLocked : NOTES.disputed;
    }
    return NOTES.reported;
  };
  const fixed = () => Boolean(s()?.locked || s()?.final);
  return (
    <div class='tm-you-panel'>
      <div class='tm-you-answers'>
        <div class='tm-report-choices' role='group' aria-label='Report your result'>
          <For each={choices()}>
            {choice => {
              const on = () => (props.report.sending() ?? s()?.chosen) === choice.result;
              return (
                <button
                  type='button'
                  class='btn'
                  classList={{
                    'btn-primary': on() && !s()?.disputed,
                    'btn-secondary': !on() || Boolean(s()?.disputed),
                    'is-disputed': on() && Boolean(s()?.disputed)
                  }}
                  aria-pressed={on()}
                  disabled={props.report.busy() || (fixed() && !on())}
                  aria-disabled={fixed() ? 'true' : undefined}
                  onClick={() => {
                    if (!fixed()) {
                      void props.report.send(choice.result);
                    }
                  }}
                >
                  {choice.label}
                  <Show when={on() && s()?.disputed}>
                    <span class='sr-only'> (your opponent reported otherwise)</span>
                  </Show>
                </button>
              );
            }}
          </For>
        </div>
        <strong class='tm-you-status' classList={{ 'is-bad': Boolean(s()?.disputed) }} role='status'>
          {status()}
        </strong>
      </div>
      <p class='tm-you-note muted'>{note()}</p>
      <ErrorLine message={props.report.error()} />
    </div>
  );
}

/** How the match went for the viewer, once it is decided; null while it is being played. */
function decided(report: Report, found: Found, me: string, view: TournamentView): PlayerResult | null {
  const state = report.state();
  if (state) {
    return state.final ? state.chosen : null;
  }
  const { outcome } = shownOutcome(found.match, found.pod, found.round, view.pending);
  return outcome === 'pending' ? null : sideResult(outcome, found.match.p1 === me ? 1 : 2);
}

function MatchLine(props: Props & { me: string; found: Found; report: Report; open: boolean; onOpen: () => void }) {
  const names = () => namesById(props.view.tournament);
  const opponent = () => (props.found.match.p1 === props.me ? props.found.match.p2 : props.found.match.p1);
  const result = () => decided(props.report, props.found, props.me, props.view);
  const canReport = () => Boolean(props.report.state()) && props.reports && !props.open;
  return (
    <Show
      when={opponent()}
      fallback={
        <>
          <span class='tm-you-big'>{props.found.match.outcome === 'bye' ? 'Bye' : 'Missed round'}</span>
          <span class='tm-you-mid muted'>{props.found.match.outcome === 'bye' ? 'Counts as a win' : ''}</span>
          <span class='tm-you-end'>
            <Clock round={props.found.round} />
          </span>
        </>
      }
    >
      {id => (
        <>
          <span class='tm-you-big'>
            <small>Table</small>
            <span class='num'>{props.found.match.table}</span>
          </span>
          <span class='tm-you-mid'>
            <span class='muted'>vs</span>{' '}
            <button type='button' class='tm-seat-link' onClick={() => props.onPlayer?.(id())}>
              <span class='tm-name'>{names().get(id())}</span>
            </button>{' '}
            <span class='muted num'>
              {recordsBefore(withSwiss(props.view.tournament, props.found.pod), props.found.round).get(id())}
            </span>
          </span>
          <span class='tm-you-end'>
            <Show
              when={result()}
              fallback={
                <>
                  <Clock round={props.found.round} />
                  <Show when={canReport()}>
                    <button type='button' class='btn btn-secondary tm-small' onClick={() => props.onOpen()}>
                      Report result
                    </button>
                  </Show>
                </>
              }
            >
              {r => (
                <strong>
                  {props.report.state() ? 'Result stands · ' : ''}You {SAID[r()]}
                </strong>
              )}
            </Show>
          </span>
        </>
      )}
    </Show>
  );
}

/** Where the viewer finished: their place in their division, record and points. */
function placeOf(view: TournamentView, me: string) {
  const pod = podOf(view.tournament, me);
  if (!pod || pod.rounds.length === 0) {
    return null;
  }
  const divisionOf = (id: string) => view.divisions[id] ?? 'masters';
  const rows = podStandings(view.tournament, pod, divisionOf).flatMap(group => group.rows);
  return rows.find(row => row.playerId === me) ?? null;
}

function MatchBox(props: Props & { me: string }) {
  const [open, setOpen] = createSignal(false);
  const found = () => (props.view.settings.finished ? null : currentMatchOf(props.view.tournament, props.me));
  // Props go through whole: spreading them into an object would read them once and lose later updates.
  const report = createReport(props, found);
  const placed = () => (props.view.settings.finished ? placeOf(props.view, props.me) : null);
  const started = () => hasStarted(props.view.tournament);
  const panel = () => {
    const state = report.state();
    return props.reports && state && !state.final && (open() || state.disputed) ? state : null;
  };
  /** Another device reports for this player: this one follows the table and says why it cannot report. */
  const followsOnly = () => {
    const state = report.state();
    return !props.reports && state !== null && !state.final;
  };
  const division = () => divisionHeading(props.view.divisions[props.me] ?? null);
  return (
    <section class='tm-box tm-you' aria-label='Your match'>
      <div class='tm-you-top'>
        <Switch
          fallback={
            <>
              <span class='tm-you-big'>{started() ? 'Not paired' : 'Registered'}</span>
              <span class='tm-you-mid'>{!started() && props.firstRound ? `Round 1 at ${props.firstRound}` : ''}</span>
            </>
          }
        >
          <Match when={placed()}>
            {row => (
              <>
                <span class='tm-you-big'>
                  <small>Place</small>
                  <span class='num'>{ordinal(row().place)}</span>
                </span>
                <span class='tm-you-mid num'>
                  {recordLabel(row().record)} · {row().points} pt{row().points === 1 ? '' : 's'}
                </span>
              </>
            )}
          </Match>
          <Match when={found()}>
            {/* A dispute opens the panel on its own, so Report result goes whenever the panel shows. */}
            {f => (
              <MatchLine {...props} found={f()} report={report} open={Boolean(panel())} onOpen={() => setOpen(true)} />
            )}
          </Match>
        </Switch>
      </div>
      <Show when={followsOnly()}>
        <p class='tm-you-panel tm-you-note muted'>{NOT_REPORTER}</p>
      </Show>
      <Show when={panel() && found()}>
        {f => (
          <ReportPanel
            report={report}
            found={f()}
            opponent={
              namesById(props.view.tournament)
                .get((f().match.p1 === props.me ? f().match.p2 : f().match.p1) ?? '')
                ?.split(' ')[0] ?? 'your opponent'
            }
          />
        )}
      </Show>
      <WhoLine {...props} division={division()} />
    </section>
  );
}

/**
 * Who the box is for, and the way out when it is someone else's: forgetting
 * them on this device, or for an account's Claim, undoing it. An account
 * that is the player by its POP ID is that player wherever it signs in.
 */
function WhoLine(props: Props & { me: string; division: string }) {
  const [error, setError] = createSignal<string | null>(null);
  // How the signed-in account is this player, if it is: by its POP ID, or by its Claim.
  const via = () => (props.view.viewer.me === props.me ? props.view.viewer.via : null);
  async function unlink() {
    setError(null);
    try {
      await props.onUnlink();
    } catch (err) {
      setError(errorText(err));
    }
  }
  return (
    <>
      <div class='tm-you-who'>
        <span class='muted'>
          {namesById(props.view.tournament).get(props.me)}
          {props.division ? ` · ${props.division}` : ''}
          {via() === 'claim' ? ' · Linked to your account' : ''}
        </span>
        <Switch
          fallback={
            <button type='button' class='btn btn-ghost tm-small' onClick={() => props.onForget()}>
              Not you?
            </button>
          }
        >
          <Match when={via() === 'pop'}>{null}</Match>
          <Match when={via() === 'claim'}>
            <ConfirmAction
              label='Not you?'
              question='Unlink from your account?'
              confirmLabel='Unlink'
              danger
              onConfirm={() => void unlink()}
            />
          </Match>
        </Switch>
      </div>
      <ErrorLine message={error()} />
    </>
  );
}

/**
 * The viewer's match once the page knows who they are. Where players report
 * and a round is on, it first asks; elsewhere, a player marks themselves
 * from their player sheet (proving it the same way) and nothing shows until
 * they do.
 */
export function YourMatch(props: Props) {
  const reporting = () => props.view.settings.playerReporting;
  const live = () => !props.view.settings.finished && hasStarted(props.view.tournament);
  // An account that is the player needs no proof from this device to be shown its table.
  const known = () => props.me !== null && (props.claim !== null || props.view.viewer.me === props.me);
  return (
    <Switch>
      <Match when={reporting() && live() && !known()}>
        <WhichPlayer {...props} />
      </Match>
      <Match when={props.me}>{me => <MatchBox {...props} me={me()} claim={reporting() ? props.claim : null} />}</Match>
    </Switch>
  );
}
