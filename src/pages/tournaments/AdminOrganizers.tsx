/**
 * The admin page's Organizers tab: every account with a role, by name, with
 * its email, POP ID, role, when the role last changed and how many events it
 * owns. An Organizer's access is removed with Revoke and given back with
 * Reinstate, each asked first; an Admin is listed, never changed here.
 */

import { createResource, createSignal, For, Show } from 'solid-js';
import type { RoleHolder } from '../../../shared/accounts/types';
import { Skeleton } from '../../components/Skeleton';
import { errorText } from '../../lib/tournament/api';
import { fetchRoleHolders, ROLE_WORDS, setOrganizerAccess } from '../../lib/tournament/admin';
import { dayOf } from '../../lib/tournament/applications';
import { resolved } from '../../lib/resource';
import { ConfirmAction } from './ConfirmAction';
import { ErrorLine } from './Field';

const eventCount = (n: number) => `${n} event${n === 1 ? '' : 's'}`;

/** Revoke for a Community organizer, Reinstate for a revoked one; nothing for an Admin. */
function Access(props: { account: RoleHolder; onChanged: (account: RoleHolder) => void }) {
  const [error, setError] = createSignal<string | null>(null);
  const revoking = () => props.account.role === 'community';
  async function change() {
    setError(null);
    try {
      const { account } = await setOrganizerAccess(props.account.id, revoking() ? 'revoked' : 'community');
      props.onChanged(account);
    } catch (err) {
      setError(errorText(err));
    }
  }
  return (
    <Show when={props.account.role !== 'admin'}>
      <ConfirmAction
        label={revoking() ? 'Revoke' : 'Reinstate'}
        question={revoking() ? 'Revoke access?' : 'Reinstate access?'}
        danger={revoking()}
        onConfirm={() => void change()}
      />
      <ErrorLine message={error()} />
    </Show>
  );
}

function HolderRow(props: { account: RoleHolder; onChanged: (account: RoleHolder) => void }) {
  const a = () => props.account;
  return (
    <tr classList={{ 'is-revoked': a().role === 'revoked' }}>
      <td class='tm-person-name'>{a().name}</td>
      <td class='muted-cell tm-person-email'>{a().email ?? ''}</td>
      <td class='tm-num tm-person-pop'>
        <Show when={a().popId}>
          {popId => (
            <>
              <span class='tm-phone-only'>POP ID </span>
              {popId()}
            </>
          )}
        </Show>
      </td>
      <td class='tm-person-role'>{ROLE_WORDS[a().role]}</td>
      <td class='muted-cell tm-num tm-nowrap tm-person-since'>{a().roleAt ? dayOf(a().roleAt as number) : ''}</td>
      <td class='num tm-person-events'>
        <span class='tm-wide-only'>{a().events}</span>
        <span class='tm-phone-only'>{eventCount(a().events)}</span>
      </td>
      <td class='tm-extra-col tm-person-acts'>
        <span class='tm-row-actions'>
          <Access account={a()} onChanged={props.onChanged} />
        </span>
      </td>
    </tr>
  );
}

export function AdminOrganizers() {
  const [list, { refetch, mutate }] = createResource(() => fetchRoleHolders().then(answer => answer.accounts));
  const changed = (account: RoleHolder) => mutate(prev => prev?.map(row => (row.id === account.id ? account : row)));
  return (
    <Show
      when={resolved(list)}
      fallback={
        <Show when={list.error} fallback={<Skeleton height='160px' />}>
          <ErrorLine message={errorText(list.error)} />
          <button type='button' class='btn btn-secondary tm-small' onClick={() => void refetch()}>
            Retry
          </button>
        </Show>
      }
    >
      {accounts => (
        <section class='tm-box'>
          <Show when={accounts().length > 0} fallback={<p class='tm-empty muted'>No organizers yet</p>}>
            <div class='table-wrap'>
              <table class='data tm-people'>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>POP ID</th>
                    <th>Role</th>
                    <th>Since</th>
                    <th class='num'>Events</th>
                    <th>
                      <span class='sr-only'>Access</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <For each={accounts()}>{account => <HolderRow account={account} onChanged={changed} />}</For>
                </tbody>
              </table>
            </div>
          </Show>
        </section>
      )}
    </Show>
  );
}
