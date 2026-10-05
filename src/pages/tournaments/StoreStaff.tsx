/**
 * Store settings' Staff: everyone in the store with what they are, each made
 * a Manager or Staff or taken out in place, and the invite links. A link lets
 * one person in, as the role it was made for, for a week; its address shows
 * only as it is made, and every link still open is listed to withdraw. The
 * server keeps a store from losing its last Manager and says so.
 */

import { useNavigate } from '@solidjs/router';
import { createResource, createSignal, For, Show } from 'solid-js';
import type { StoreRole } from '../../../shared/accounts/stores';
import type { StoreInvite, StoreMember } from '../../../shared/accounts/types';
import { errorText } from '../../lib/tournament/api';
import { dayOf } from '../../lib/tournament/applications';
import {
  createInvite,
  fetchPeople,
  inviteId,
  inviteLink,
  removeMember,
  setMemberRole,
  withdrawInvite
} from '../../lib/tournament/stores';
import { latestValue } from '../../lib/resource';
import { Skeleton } from '../../components/Skeleton';
import { ConfirmAction } from './ConfirmAction';
import { ErrorLine } from './Field';
import { refreshSession, session } from './session';

const ROLE_WORDS: Record<StoreRole, string> = { manager: 'Manager', staff: 'Staff' };

/**
 * One open link: as what it lets someone in and until when, and Withdraw. The
 * one just made also shows its address, the only time it can, with Copy.
 */
function InviteRow(props: { invite: StoreInvite; link: string | null; busy: boolean; onWithdraw: () => void }) {
  const [copied, setCopied] = createSignal(false);
  async function copy(link: string) {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div class='tm-box-bar tm-store-invite'>
      <span class='tm-store-invite-what'>
        {ROLE_WORDS[props.invite.role]} invite
        <span class='muted'> · expires {dayOf(props.invite.expiresAt)}</span>
      </span>
      <Show when={props.link}>
        {link => (
          <div class='tm-store-invite-box'>
            <span class='tm-set-inline tm-invite'>
              <input
                class='tm-input tm-link'
                readOnly
                value={link()}
                aria-label={`${ROLE_WORDS[props.invite.role]} invite link`}
                onFocus={e => e.currentTarget.select()}
              />
              <button type='button' class='btn btn-secondary' onClick={() => void copy(link())}>
                {copied() ? 'Copied' : 'Copy'}
              </button>
            </span>
            <span class='muted tm-small tm-invite-hint'>
              Anyone with a Ciphermaniac account can join your store's organizer team with this one-time link.
            </span>
          </div>
        )}
      </Show>
      <button type='button' class='btn btn-ghost tm-small' disabled={props.busy} onClick={() => props.onWithdraw()}>
        Withdraw
      </button>
    </div>
  );
}

function MemberRow(props: {
  member: StoreMember;
  you: boolean;
  busy: boolean;
  onRole: (role: StoreRole) => void;
  onRemove: () => void;
}) {
  const other = (): StoreRole => (props.member.role === 'manager' ? 'staff' : 'manager');
  return (
    <tr>
      <td>
        {props.member.name}
        <Show when={props.you}>
          <span class='tm-flag is-you'>You</span>
        </Show>
      </td>
      <td>{ROLE_WORDS[props.member.role]}</td>
      <td class='muted-cell tm-wide-col'>{props.member.hasPopId ? 'On file' : 'None'}</td>
      <td class='tm-extra-col'>
        <span class='tm-row-actions'>
          <button
            type='button'
            class='btn btn-ghost tm-small'
            disabled={props.busy}
            onClick={() => props.onRole(other())}
          >
            {other() === 'manager' ? 'Make manager' : 'Make staff'}
          </button>
          <ConfirmAction
            class='btn btn-ghost tm-small'
            label={props.you ? 'Leave' : 'Remove'}
            question={props.you ? 'Leave this store?' : `Remove ${props.member.name}?`}
            confirmLabel={props.you ? 'Leave' : 'Remove'}
            danger
            disabled={props.busy}
            onConfirm={() => props.onRemove()}
          />
        </span>
      </td>
    </tr>
  );
}

export function StoreStaff(props: { storeId: string }) {
  const navigate = useNavigate();
  const [people, { mutate, refetch }] = createResource(() => props.storeId, fetchPeople);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  // The link made last on this page, by the name the list gives it: its address is shown nowhere else.
  const [made, setMade] = createSignal<{ id: string; link: string } | null>(null);
  const me = () => latestValue(session)?.user?.id;

  async function act(step: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await step();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  // Each step reads the store and who is signed in as it is pressed, then runs on those.
  function changeRole(member: StoreMember, role: StoreRole) {
    const store = props.storeId;
    // A Manager who makes themselves Staff can no longer change the store: on to its page.
    const stepping = member.id === me() && role === 'staff';
    void act(async () => {
      mutate(await setMemberRole(store, member.id, role));
      if (stepping) {
        await refreshSession();
        navigate(`/stores/${store}`);
      }
    });
  }
  function remove(member: StoreMember) {
    const store = props.storeId;
    const leaving = member.id === me();
    void act(async () => {
      await removeMember(store, member.id);
      if (leaving) {
        await refreshSession();
        navigate('/host');
        return;
      }
      await refetch();
    });
  }
  function invite(role: StoreRole) {
    const store = props.storeId;
    void act(async () => {
      const { token } = await createInvite(store, role);
      setMade({ id: await inviteId(token), link: inviteLink(location.origin, token) });
      await refetch();
    });
  }
  function withdraw(id: string) {
    const store = props.storeId;
    void act(async () => {
      await withdrawInvite(store, id);
      await refetch();
    });
  }

  return (
    <section class='tm-store-section' aria-labelledby='store-staff-head'>
      <h2 class='tm-subhead tm-box-head' id='store-staff-head'>
        Staff
      </h2>
      <Show
        when={latestValue(people)}
        fallback={
          <Show when={people.error} fallback={<Skeleton height='160px' />}>
            <ErrorLine message={errorText(people.error)} />
          </Show>
        }
      >
        {current => (
          <div class='tm-box'>
            <div class='table-wrap'>
              <table class='data tm-store-staff'>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Role</th>
                    <th class='tm-wide-col'>POP ID</th>
                    <th>
                      <span class='sr-only'>Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <For each={current().members}>
                    {member => (
                      <MemberRow
                        member={member}
                        you={member.id === me()}
                        busy={busy()}
                        onRole={role => changeRole(member, role)}
                        onRemove={() => remove(member)}
                      />
                    )}
                  </For>
                </tbody>
              </table>
            </div>
            <For each={current().invites}>
              {open => (
                <InviteRow
                  invite={open}
                  link={made()?.id === open.id ? (made()?.link ?? null) : null}
                  busy={busy()}
                  onWithdraw={() => withdraw(open.id)}
                />
              )}
            </For>
            <div class='tm-box-bar'>
              <button type='button' class='btn btn-secondary' disabled={busy()} onClick={() => invite('staff')}>
                Invite staff
              </button>
              <button type='button' class='btn btn-ghost' disabled={busy()} onClick={() => invite('manager')}>
                Invite a manager
              </button>
            </div>
          </div>
        )}
      </Show>
      <ErrorLine message={error()} />
    </section>
  );
}
