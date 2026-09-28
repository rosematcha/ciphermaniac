/**
 * Every tournament route through one entry in main.tsx: /host (an
 * organizer's events), /host/:code (running one), /t/:code (the public page
 * players follow), and /account (sign-in and player profile). One route
 * rather than four, because each route added to main.tsx is paid for in the
 * app shell; each page is still its own chunk, so a player following
 * pairings never downloads the organizer's console.
 */

import { useLocation, useParams } from '@solidjs/router';
import { lazy, Match, Switch } from 'solid-js';
import '../styles/pages/tournament.css';

const AccountPage = lazy(() => import('./tournaments/AccountPage').then(m => ({ default: m.AccountPage })));
const HostIndex = lazy(() => import('./tournaments/HostIndex').then(m => ({ default: m.HostIndex })));
const ManageEvent = lazy(() => import('./tournaments/ManageEvent').then(m => ({ default: m.ManageEvent })));
const PublicEvent = lazy(() => import('./tournaments/PublicEvent').then(m => ({ default: m.PublicEvent })));

export function TournamentsPage() {
  const location = useLocation();
  const params = useParams<{ code?: string }>();
  const code = () => (params.code ?? '').toUpperCase();
  return (
    <Switch fallback={<HostIndex />}>
      <Match when={location.pathname.startsWith('/account')}>
        <AccountPage />
      </Match>
      <Match when={location.pathname.startsWith('/t/') && code()}>
        <PublicEvent code={code()} />
      </Match>
      <Match when={location.pathname.startsWith('/host/') && code()}>
        <ManageEvent code={code()} />
      </Match>
    </Switch>
  );
}
