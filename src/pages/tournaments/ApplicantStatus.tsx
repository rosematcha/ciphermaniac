/**
 * Where an account stands on running events (see applicantStage), on
 * Settings and the apply page: the stage in words, its day, the admin's note
 * on a rejection, and the step it leaves (apply, withdraw, apply again, the
 * events, the admin page). On /host, one line in the hero: the stage and its
 * step, for an account that may not start events.
 */

import { A } from '@solidjs/router';
import { createEffect, createResource, createSignal, Match, Show, Switch } from 'solid-js';
import type { AccountRole } from '../../../shared/accounts/roles';
import type { MyApplication } from '../../../shared/accounts/types';
import { errorText } from '../../lib/tournament/api';
import {
  type ApplicantStage,
  applicantStage,
  dayOf,
  fetchApplication,
  withdrawApplication
} from '../../lib/tournament/applications';
import { resolved } from '../../lib/resource';
import { ConfirmAction } from './ConfirmAction';
import { ErrorLine } from './Field';
import { refreshSession } from './session';
import '../../styles/pages/tournament-apply.css';

const STAGE_WORDS: Record<ApplicantStage, string> = {
  none: '',
  pending: 'Application pending',
  rejected: 'Not approved',
  organizer: 'Organizer',
  revoked: 'Organizer access removed',
  admin: 'Admin'
};

/** The day under the stage: when a pending Application went in, or when a rejection came. */
function stageDay(stage: ApplicantStage, application: MyApplication | null): string | null {
  if (stage === 'pending' && application) {
    return `Sent ${dayOf(application.createdAt)}`;
  }
  return stage === 'rejected' && application?.decidedAt ? dayOf(application.decidedAt) : null;
}

/** Apply again: to the apply page's form, or, on that page, opening it in place. */
function ApplyAgain(props: { onApply: (() => void) | undefined }) {
  return (
    <Show
      when={props.onApply}
      fallback={
        <A class='btn btn-secondary' href='/apply?again=1'>
          Apply again
        </A>
      }
    >
      {apply => (
        <button type='button' class='btn btn-secondary' onClick={() => apply()()}>
          Apply again
        </button>
      )}
    </Show>
  );
}

/** Withdrawing a pending Application, asked first: it takes the proof with it. */
function Withdraw(props: { onWithdrawn: () => void }) {
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  async function withdraw() {
    setBusy(true);
    setError(null);
    try {
      await withdrawApplication();
      props.onWithdrawn();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <ConfirmAction
        class='btn btn-secondary'
        label='Withdraw'
        question='Withdraw your application?'
        danger
        disabled={busy()}
        onConfirm={() => void withdraw()}
      />
      <ErrorLine message={error()} />
    </>
  );
}

/** The step each stage leaves. `again` is left out on the apply page once its form is open. */
function StageStep(props: {
  stage: ApplicantStage;
  again: boolean;
  onApplyAgain: (() => void) | undefined;
  onChanged: () => void;
}) {
  return (
    <Switch>
      <Match when={props.stage === 'none'}>
        <A class='btn btn-secondary' href='/apply'>
          Apply to run events
        </A>
      </Match>
      <Match when={props.stage === 'pending'}>
        <Withdraw onWithdrawn={props.onChanged} />
      </Match>
      <Match when={(props.stage === 'rejected' || props.stage === 'revoked') && props.again}>
        <ApplyAgain onApply={props.onApplyAgain} />
      </Match>
      <Match when={props.stage === 'organizer'}>
        <A class='btn btn-secondary' href='/host'>
          Your events
        </A>
      </Match>
      <Match when={props.stage === 'admin'}>
        <A class='btn btn-secondary' href='/admin'>
          Admin page
        </A>
        <A class='btn btn-ghost' href='/host'>
          Your events
        </A>
      </Match>
    </Switch>
  );
}

/**
 * The stage in full, in a box: its words and day at left, its step at right,
 * and the admin's note to the applicant under a rejection. On Settings,
 * Apply again leads to the apply page; there, `onApplyAgain` opens the form
 * instead, and `again: false` drops the step once it is open.
 */
export function ApplicantStatus(props: {
  stage: ApplicantStage;
  application: MyApplication | null;
  again?: boolean;
  onApplyAgain?: () => void;
  onChanged: () => void;
}) {
  const note = () => (props.stage === 'rejected' ? props.application?.note : null);
  return (
    <div class='tm-box tm-applicant'>
      <div class='tm-box-bar'>
        <Show when={STAGE_WORDS[props.stage]}>
          {words => (
            <span class='tm-applicant-stage'>
              <strong>{words()}</strong>
              <Show when={stageDay(props.stage, props.application)}>
                {day => <span class='muted tm-num'>{day()}</span>}
              </Show>
            </span>
          )}
        </Show>
        <span class='tm-applicant-step'>
          <StageStep
            stage={props.stage}
            again={props.again ?? true}
            onApplyAgain={props.onApplyAgain}
            onChanged={props.onChanged}
          />
        </span>
      </div>
      <Show when={note()}>{text => <p class='tm-box-bar tm-applicant-note'>{text()}</p>}</Show>
    </div>
  );
}

/**
 * Rereads who is signed in, once, when the account's Application was
 * approved after the page read it as a player: until then the page offers
 * an Organizer neither the way to start events nor the way to apply.
 */
export function createSessionCatchUp(role: () => AccountRole | null, latest: () => MyApplication | null | undefined) {
  let reread = false;
  createEffect(() => {
    if (!reread && role() === null && latest()?.status === 'approved') {
      reread = true;
      void refreshSession();
    }
  });
}

/**
 * /host's line for an account that may not start events: the way to apply,
 * or where its Application stands. `primary`: applying is the page's one
 * step, with no event of its own running.
 */
export function ApplicantLine(props: { role: AccountRole | null; primary: boolean }) {
  const [state] = createResource(fetchApplication);
  createSessionCatchUp(
    () => props.role,
    () => resolved(state)?.application
  );
  // Unread for an error, the way to apply still shows: the apply page says where things stand.
  const stage = () => {
    const current = resolved(state);
    return current || state.error ? applicantStage(props.role, current?.application ?? null) : null;
  };
  return (
    <Show when={stage()}>
      {current => (
        <span class='tm-hero-acts tm-applicant-line'>
          <Show
            when={STAGE_WORDS[current()]}
            fallback={
              <A class={props.primary ? 'btn btn-primary' : 'btn btn-secondary'} href='/apply'>
                Apply to run events
              </A>
            }
          >
            {words => <span class='tm-applicant-words'>{words()}</span>}
          </Show>
          <Show when={current() === 'rejected' || current() === 'revoked'}>
            <ApplyAgain onApply={undefined} />
          </Show>
        </span>
      )}
    </Show>
  );
}
