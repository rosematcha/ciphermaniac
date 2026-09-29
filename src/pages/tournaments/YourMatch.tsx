/**
 * The viewer's own match on the public page, in two sizes. The strip says
 * where they sit and against whom, with the clock; where players report,
 * Report result opens it into the panel of answers. The button they pressed
 * is the state: accented once reported, marked when the opponent says
 * otherwise, and fixed once the result stands. A report can change until it
 * locks (see shared/tournament/reports.ts). Before round 1 the strip says
 * they are registered; once the event ends, where they placed.
 *
 * Where players report, they say who they are once (Player ID, or at an
 * unsanctioned event their last name), and the device remembers it.
 */

import { createEffect, createSignal, For, Match, Show, Switch } from 'solid-js';
import type { PlayerClaim } from '../../../shared/tournament/identify';
import type { PlayerResult } from '../../../shared/tournament/reports';
import { recordLabel, sideResult } from '../../../shared/tournament/standings';
import type { Pod, Round, Match as TableMatch } from '../../../shared/tournament/types';
import { isSanctioned, type PublishedView, type TournamentView } from '../../../shared/tournament/view';
import { ApiError, identifyPlayer, reportAsPlayer } from '../../lib/tournament/api';
import {
  currentMatchOf,
  divisionHeading,
  namesById,
  ordinal,
  podStandings,
  recordsBefore,
  reportState,
  shownOutcome
} from '../../lib/tournament/present';
import { Clock } from './Clock';
import { ErrorLine, Field } from './Field';
import { createNow } from './now';

const claimKey = (code: string) => `cm-tournament-player:${code}`;

function storedClaim(code: string): PlayerClaim | null {
  try {
    return JSON.parse(localStorage.getItem(claimKey(code)) ?? 'null') as PlayerClaim | null;
  } catch {
    return null;
  }
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

const SAID: Record<PlayerResult, string> = { win: 'won', loss: 'lost', tie: 'tied' };

const NOTES = {
  open: 'You and your opponent both report. When the two reports match, the result counts.',
  reported: 'You can change your report until the timer runs out. After that it waits for your opponent’s.',
  disputed: 'Your reports don’t match. If you pressed the wrong one, change it. Otherwise, find a judge.'
};

interface Props {
  view: TournamentView;
  me: string | null;
  onMe: (key: string | null) => void;
  onView: (view: PublishedView) => void;
  onPlayer?: (id: string) => void;
  /** The start of round 1, formatted, or null when unset. */
  firstRound: string | null;
}

interface Found {
  pod: Pod;
  round: Round;
  match: TableMatch;
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
    <section class='tm-box tm-you tm-you-ask' aria-label='Your match'>
      <h2 class='tm-you-q'>Which player are you?</h2>
      <form class='tm-you-find' onSubmit={event => void find(event)}>
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
      <p class='tm-you-note muted'>
        Enter your {sanctioned() ? 'Player ID' : 'last name'} to see your table and report your result. This phone will
        remember you.
      </p>
      <ErrorLine message={error()} />
    </section>
  );
}

const CHOICES: { result: PlayerResult; label: string }[] = [
  { result: 'win', label: 'I won' },
  { result: 'loss', label: 'I lost' },
  { result: 'tie', label: 'Tie' }
];

/** The viewer's report of their match: where it stands, sending it, and settling it once both agree. */
function createReport(props: Props & { me: string; claim: PlayerClaim | null }, found: () => Found | null) {
  const now = createNow();
  const [busy, setBusy] = createSignal(false);
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
    if (!claim) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      props.onView((await reportAsPlayer(props.view.code, claim, result)).view);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function settle(claim: PlayerClaim) {
    setSettling(true);
    const answer = await identifyPlayer(props.view.code, claim).catch(() => null);
    if (answer) {
      props.onView(answer.view);
    }
    // Clocks differ by a second or two; if the server did not settle it yet, ask again shortly.
    setTimeout(() => setSettling(false), 5000);
  }

  // Once both reports agree and lock, asking again writes the result in, so it shows as it stands.
  createEffect(() => {
    const { claim } = props;
    if (claim && state()?.final && found()?.match.outcome === 'pending' && !settling()) {
      void settle(claim);
    }
  });

  return { state, busy, error, send };
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
    return state.disputed ? NOTES.disputed : NOTES.reported;
  };
  const fixed = () => Boolean(s()?.locked || s()?.final);
  return (
    <div class='tm-you-panel'>
      <div class='tm-you-answers'>
        <div class='tm-report-choices' role='group' aria-label='Report your result'>
          <For each={choices()}>
            {choice => {
              const on = () => s()?.chosen === choice.result;
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
  const canReport = () => Boolean(props.report.state()) && !props.open;
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
            <span class='muted num'>{recordsBefore(props.found.pod, props.found.round).get(id())}</span>
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
  const pod = view.tournament.pods.find(p => p.playerIds.includes(me));
  if (!pod || pod.rounds.length === 0) {
    return null;
  }
  const divisionOf = (id: string) => view.divisions[id] ?? 'masters';
  const rows = podStandings(view.tournament, pod, divisionOf).flatMap(group => group.rows);
  return rows.find(row => row.playerId === me) ?? null;
}

function MatchBox(props: Props & { me: string; claim: PlayerClaim | null; onForget: () => void }) {
  const [open, setOpen] = createSignal(false);
  const found = () => (props.view.settings.finished ? null : currentMatchOf(props.view.tournament, props.me));
  // Props go through whole: spreading them into an object would read them once and lose later updates.
  const report = createReport(props, found);
  const placed = () => (props.view.settings.finished ? placeOf(props.view, props.me) : null);
  const started = () => props.view.tournament.pods.some(pod => pod.rounds.length > 0);
  const panel = () => {
    const state = report.state();
    return state && !state.final && (open() || state.disputed) ? state : null;
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
            {f => <MatchLine {...props} found={f()} report={report} open={open()} onOpen={() => setOpen(true)} />}
          </Match>
        </Switch>
      </div>
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
      <div class='tm-you-who'>
        <span class='muted'>
          {namesById(props.view.tournament).get(props.me)}
          {division() ? ` · ${division()}` : ''}
        </span>
        <button type='button' class='btn btn-ghost tm-small' onClick={() => props.onForget()}>
          Not you?
        </button>
      </div>
    </section>
  );
}

/**
 * The viewer's match once the page knows who they are. Where players report
 * and a round is on, it first asks; elsewhere, a player marks themselves
 * from their player sheet and nothing shows until they do.
 */
export function YourMatch(props: Props) {
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
  const reporting = () => props.view.settings.playerReporting;
  const live = () => !props.view.settings.finished && props.view.tournament.pods.some(pod => pod.rounds.length > 0);
  const forget = () => {
    remember(null);
    props.onMe(null);
  };
  return (
    <Switch>
      <Match when={reporting() && live() && (!claim() || !props.me)}>
        <WhichPlayer {...props} onClaim={remember} />
      </Match>
      <Match when={props.me}>
        {me => <MatchBox {...props} me={me()} claim={reporting() ? claim() : null} onForget={forget} />}
      </Match>
    </Switch>
  );
}
