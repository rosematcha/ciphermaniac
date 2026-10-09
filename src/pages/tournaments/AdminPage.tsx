/**
 * /admin: an Admin's page; for anyone else, signed in or not, it is not
 * found. Three tabs: Applications (the queue to decide, see
 * AdminApplications), Organizers (every account with a role, and its
 * access, see AdminOrganizers) and POP IDs (settling who holds one, see
 * AdminPopIds). The tab is kept in the address, so a reload stays on it.
 */

import { useSearchParams } from '@solidjs/router';
import { createEffect, Match, Show, Switch } from 'solid-js';
import { isAdmin } from '../../../shared/accounts/roles';
import { Tabs } from '../../components/Tabs';
import { latestValue } from '../../lib/resource';
import { AdminApplications } from './AdminApplications';
import { AdminOrganizers } from './AdminOrganizers';
import { AdminPopIds } from './AdminPopIds';
import { TournamentHero } from './Hero';
import { session } from './session';
import '../../styles/pages/tournament-admin.css';

type Tab = 'applications' | 'organizers' | 'pop-ids';

const TABS: { value: Tab; label: string }[] = [
  { value: 'applications', label: 'Applications' },
  { value: 'organizers', label: 'Organizers' },
  { value: 'pop-ids', label: 'POP IDs' }
];

function Admin() {
  const [params, setParams] = useSearchParams<{ tab?: string }>();
  const tab = (): Tab => TABS.find(option => option.value === params.tab)?.value ?? 'applications';
  return (
    <>
      <TournamentHero title='Admin' tab='admin' />
      <Tabs
        options={TABS}
        selected={tab()}
        onSelect={value => setParams({ tab: value }, { replace: true })}
        ariaLabel='Admin sections'
      />
      <Switch>
        <Match when={tab() === 'applications'}>
          <AdminApplications />
        </Match>
        <Match when={tab() === 'organizers'}>
          <AdminOrganizers />
        </Match>
        <Match when={tab() === 'pop-ids'}>
          <AdminPopIds />
        </Match>
      </Switch>
    </>
  );
}

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
          <Admin />
        </Show>
      </Show>
    </div>
  );
}
