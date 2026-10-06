/**
 * The admin page's Applications tab: the queue of pending ones, oldest
 * first, with a switch to the approved or rejected ones. Each shows the name
 * and POP ID it was sent with, the account as it is now, the store it asks
 * for, why, and the role approving gives the applicant in it, the explanation
 * and the proof (an image opens in a sheet; a PDF downloads), and a pending
 * one takes Approve or Reject with an optional note to the applicant. A
 * decided one stays in place, showing the decision, until the list is read
 * again.
 */

import { createResource, createSignal, For, Show } from 'solid-js';
import { NOTE_MAX } from '../../../shared/accounts/applications';
import { roleForRelationship } from '../../../shared/accounts/stores';
import type { AdminApplication, ApplicationStatus } from '../../../shared/accounts/types';
import { BottomSheet } from '../../components/BottomSheet';
import { Segmented } from '../../components/Segmented';
import { Skeleton } from '../../components/Skeleton';
import { ApiError, errorText } from '../../lib/tournament/api';
import { decideApplication, fetchApplications, proofUrl } from '../../lib/tournament/admin';
import { dayOf } from '../../lib/tournament/applications';
import { RELATIONSHIP_LABELS, STORE_ROLE_WORDS } from '../../lib/tournament/stores';
import { resolved } from '../../lib/resource';
import { ErrorLine } from './Field';

const STATUSES: { value: ApplicationStatus; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' }
];

const DECIDED: Record<ApplicationStatus, string> = { pending: '', approved: 'Approved', rejected: 'Rejected' };

/** One fact about an Application: its label at left, its value beside it. */
function Fact(props: { label: string; value: string | null | undefined }) {
  return (
    <Show when={props.value}>
      {value => (
        <div>
          <dt>{props.label}</dt>
          <dd>{value()}</dd>
        </div>
      )}
    </Show>
  );
}

/** The proof: an image to open in the sheet, a PDF to download. */
function ProofLink(props: { application: AdminApplication; onView: () => void }) {
  return (
    <Show
      when={props.application.proofType?.startsWith('image/')}
      fallback={
        <a class='btn btn-secondary tm-small' href={proofUrl(props.application.id)} download=''>
          Download proof
        </a>
      }
    >
      <button type='button' class='btn btn-secondary tm-small' onClick={() => props.onView()}>
        View proof
      </button>
    </Show>
  );
}

/**
 * Approve or Reject, with the note the applicant sees. One another Admin
 * decided first, or its applicant withdrew, sends the list to be read again
 * (`onStale`).
 */
function Decide(props: {
  application: AdminApplication;
  onDecided: (decided: AdminApplication) => void;
  onStale: () => void;
}) {
  const [note, setNote] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  async function decide(decision: 'approve' | 'reject') {
    setBusy(true);
    setError(null);
    try {
      const { application } = await decideApplication(props.application.id, decision, note());
      props.onDecided(application);
    } catch (err) {
      setError(errorText(err));
      if (err instanceof ApiError && (err.status === 404 || err.status === 409)) {
        props.onStale();
      }
    } finally {
      setBusy(false);
    }
  }
  const id = () => `note-${props.application.id}`;
  // Each row's controls are told apart by the applicant's name, its heading.
  const who = () => `app-${props.application.id}`;
  return (
    <div class='tm-app-decide'>
      <label class='tm-label' for={id()}>
        Note
      </label>
      <div class='tm-app-decide-row'>
        <input
          id={id()}
          class='tm-input'
          aria-describedby={who()}
          maxlength={NOTE_MAX}
          value={note()}
          onInput={event => setNote(event.currentTarget.value)}
        />
        <button
          type='button'
          class='btn btn-secondary tm-accept'
          aria-describedby={who()}
          disabled={busy()}
          onClick={() => void decide('approve')}
        >
          Approve
        </button>
        <button
          type='button'
          class='btn btn-ghost'
          aria-describedby={who()}
          disabled={busy()}
          onClick={() => void decide('reject')}
        >
          Reject
        </button>
      </div>
      <ErrorLine message={error()} />
    </div>
  );
}

function ApplicationRow(props: {
  application: AdminApplication;
  onView: (application: AdminApplication) => void;
  onDecided: (decided: AdminApplication) => void;
  onStale: () => void;
}) {
  const a = () => props.application;
  const decidedBy = () => {
    const at = a().decidedAt;
    return at ? `${dayOf(at)}${a().decidedBy ? ` by ${a().decidedBy?.name}` : ''}` : null;
  };
  return (
    <article class='tm-app'>
      <div class='tm-app-who'>
        <h3 id={`app-${a().id}`}>
          {a().applied.firstName} {a().applied.lastName}
          <Show when={DECIDED[a().status]}>{word => <span class='tm-flag'>{word()}</span>}</Show>
        </h3>
        <dl class='tm-app-facts'>
          <Fact label='POP ID' value={a().applied.popId} />
          <Fact label='Account' value={a().account.name} />
          <Fact label='Email' value={a().account.email} />
          <Show when={a().store}>
            {store => (
              <>
                <Fact label='Store' value={`${store().details.name} · League ${store().leagueId}`} />
                <Fact label='Reason' value={RELATIONSHIP_LABELS[store().relationship]} />
                <Fact label='Joins as' value={STORE_ROLE_WORDS[roleForRelationship(store().relationship)]} />
              </>
            )}
          </Show>
          <Fact label='Sent' value={dayOf(a().createdAt)} />
          <Fact label='Decided' value={decidedBy()} />
        </dl>
      </div>
      <div class='tm-app-what'>
        <Show when={a().explanation} fallback={<p class='muted'>No explanation</p>}>
          {text => <p class='tm-app-explanation'>{text()}</p>}
        </Show>
        <Show when={a().note}>
          {note => (
            <p class='tm-app-note'>
              <span class='muted'>Note</span> {note()}
            </p>
          )}
        </Show>
        <Show when={a().hasProof}>
          <ProofLink application={a()} onView={() => props.onView(a())} />
        </Show>
        <Show when={a().status === 'pending'}>
          <Decide application={a()} onDecided={props.onDecided} onStale={props.onStale} />
        </Show>
      </div>
    </article>
  );
}

/** The proof image, as large as the sheet holds it. The last one viewed stays in it while it closes. */
function ProofSheet(props: { application: AdminApplication | null; open: boolean; onClose: () => void }) {
  const name = () =>
    props.application ? `${props.application.applied.firstName} ${props.application.applied.lastName}` : '';
  return (
    <BottomSheet
      open={props.open}
      onClose={() => props.onClose()}
      title={`Proof from ${name()}`}
      footer={
        <Show when={props.application}>
          {a => (
            <a class='btn btn-ghost' href={proofUrl(a().id)} target='_blank' rel='noopener'>
              Open in a new tab
            </a>
          )}
        </Show>
      }
    >
      <Show when={props.application}>
        {a => <img class='tm-proof-image' src={proofUrl(a().id)} alt={`Proof from ${name()}`} />}
      </Show>
    </BottomSheet>
  );
}

const EMPTY: Record<ApplicationStatus, string> = {
  pending: 'No pending applications',
  approved: 'No approved applications',
  rejected: 'No rejected applications'
};

export function AdminApplications() {
  const [status, setStatus] = createSignal<ApplicationStatus>('pending');
  const [list, { refetch, mutate }] = createResource(status, wanted =>
    fetchApplications(wanted).then(answer => answer.applications)
  );
  const [viewing, setViewing] = createSignal<AdminApplication | null>(null);
  const [sheetOpen, setSheetOpen] = createSignal(false);
  const view = (application: AdminApplication) => {
    setViewing(application);
    setSheetOpen(true);
  };
  const decided = (application: AdminApplication) =>
    mutate(prev => prev?.map(row => (row.id === application.id ? application : row)));
  return (
    <section class='tm-box tm-apps'>
      <div class='tm-box-bar'>
        <Segmented options={STATUSES} selected={status()} onSelect={setStatus} ariaLabel='Status' />
        <span class='tm-grow' />
        {/* Decided in place, an Application leaves the count of those still in the queue. */}
        <Show when={resolved(list)}>
          {apps => (
            <span class='muted tm-num'>
              {apps().filter(application => application.status === status()).length} {status()}
            </span>
          )}
        </Show>
      </div>
      <Show
        when={resolved(list)}
        fallback={
          <Show when={list.error} fallback={<Skeleton height='160px' />}>
            <div class='tm-box-bar'>
              <ErrorLine message={errorText(list.error)} />
              <button type='button' class='btn btn-secondary tm-small' onClick={() => void refetch()}>
                Retry
              </button>
            </div>
          </Show>
        }
      >
        {apps => (
          <Show when={apps().length > 0} fallback={<p class='tm-empty muted'>{EMPTY[status()]}</p>}>
            <For each={apps()}>
              {application => (
                <ApplicationRow
                  application={application}
                  onView={view}
                  onDecided={decided}
                  onStale={() => void refetch()}
                />
              )}
            </For>
          </Show>
        )}
      </Show>
      <ProofSheet application={viewing()} open={sheetOpen()} onClose={() => setSheetOpen(false)} />
    </section>
  );
}
