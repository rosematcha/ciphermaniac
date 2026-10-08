/**
 * The dashboard's account button: the account's picture (or its initial),
 * opening a menu of the account's own pages. Stands in for the strip of
 * links (AccountStrip) the other tournament pages carry. The way to apply to
 * run events is here rather than on the page, since few accounts want it.
 */

import { A } from '@solidjs/router';
import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { isAdmin } from '../../../shared/accounts/roles';
import { canCreateEvents } from '../../../shared/accounts/stores';
import type { Me } from '../../lib/tournament/api';
import '../../styles/pages/tournament-account-menu.css';

export function AccountMenu(props: { user: Me; pending: number }) {
  const [open, setOpen] = createSignal(false);
  let root: HTMLDivElement | undefined;
  const admin = () => isAdmin(props.user.role);
  const apply = () => !canCreateEvents(props.user.role, props.user.stores);

  onMount(() => {
    const away = (event: Event) => {
      if (root && !root.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && open()) {
        setOpen(false);
        root?.querySelector('button')?.focus();
      }
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    onCleanup(() => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', key);
    });
  });

  return (
    <div class='tm-acct' ref={root}>
      <button
        type='button'
        class='tm-acct-button'
        aria-label='Account'
        aria-expanded={open()}
        onClick={() => setOpen(!open())}
      >
        <Show when={props.user.avatar} fallback={<span aria-hidden='true'>{props.user.name.slice(0, 1)}</span>}>
          {src => <img src={src()} alt='' width='34' height='34' />}
        </Show>
        <Show when={admin() && props.pending > 0}>
          <span class='tm-acct-pip' aria-hidden='true' />
        </Show>
      </button>
      <Show when={open()}>
        <div class='tm-acct-menu'>
          <p class='tm-acct-id'>
            <strong>{props.user.name}</strong>
            <span class='muted'>@{props.user.handle}</span>
          </p>
          <Show when={props.user.publicProfile}>
            <A href={`/u/${props.user.handle}`}>Public profile</A>
          </Show>
          <A href='/history'>History</A>
          <A href='/settings'>Settings</A>
          <Show when={admin()}>
            <A href='/admin'>
              Admin
              <Show when={props.pending > 0}>
                <span class='tm-dash-count'>{props.pending}</span>
              </Show>
            </A>
          </Show>
          <Show when={apply()}>
            <A class='tm-acct-quiet' href='/apply'>
              Apply to organize
            </A>
          </Show>
        </div>
      </Show>
    </div>
  );
}
