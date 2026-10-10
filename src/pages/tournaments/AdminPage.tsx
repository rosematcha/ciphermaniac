/**
 * /admin: an Admin's page; for anyone else, signed in or not, it is not
 * found. Its sections are AdminSections, the same the dashboard's Admin tab
 * shows.
 */

import { createEffect, Show } from 'solid-js';
import { isAdmin } from '../../../shared/accounts/roles';
import { latestValue } from '../../lib/resource';
import { AdminSections } from './AdminSections';
import { TournamentHero } from './Hero';
import { session } from './session';

export function AdminPage() {
  const current = () => latestValue(session);
  const admin = () => isAdmin(current()?.user?.role ?? null);
  createEffect(() => {
    document.title = admin() ? 'Admin — Ciphermaniac' : 'Not found — Ciphermaniac';
  });
  return (
    <div class='tm-page tm-admin'>
      <Show when={current()}>
        <Show when={admin()} fallback={<TournamentHero title='Page not found' />}>
          <TournamentHero title='Admin' tab='admin' />
          <AdminSections param='tab' />
        </Show>
      </Show>
    </div>
  );
}
