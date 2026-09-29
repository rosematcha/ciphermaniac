/**
 * Every tournament route through one entry in main.tsx: /host (an
 * organizer's events), /host/:code (running one), /t/:code (the public page
 * players follow), and /settings (sign-in, sign-out and the player profile;
 * /account is its older name). One route
 * rather than four, because each route added to main.tsx is paid for in the
 * app shell; each page is still its own chunk, so a player following
 * pairings never downloads the organizer's console.
 */

import { useLocation, useParams } from '@solidjs/router';
import { lazy, Match, Show, Switch } from 'solid-js';
import '../styles/pages/tournament.css';
import { AccountStrip } from './tournaments/AccountStrip';

const SettingsPage = lazy(() => import('./tournaments/SettingsPage').then(m => ({ default: m.SettingsPage })));
const HostIndex = lazy(() => import('./tournaments/HostIndex').then(m => ({ default: m.HostIndex })));
const ManageEvent = lazy(() => import('./tournaments/ManageEvent').then(m => ({ default: m.ManageEvent })));
const PublicEvent = lazy(() => import('./tournaments/PublicEvent').then(m => ({ default: m.PublicEvent })));

export function TournamentsPage() {
  const location = useLocation();
  const params = useParams<{ code?: string }>();
  const code = () => (params.code ?? '').toUpperCase();
  const screen = () => new URLSearchParams(location.search).get('screen') === '1';
  const settings = () => location.pathname.startsWith('/account') || location.pathname.startsWith('/settings');
  return (
    <>
      {/* Settings shows who is signed in itself. */}
      <Show when={!screen() && !settings()}>
        <AccountStrip />
      </Show>
      <Switch fallback={<HostIndex />}>
        <Match when={settings()}>
          <SettingsPage />
        </Match>
        <Match when={location.pathname.startsWith('/t/') && code()}>
          <PublicEvent code={code()} />
        </Match>
        <Match when={location.pathname.startsWith('/host/') && code()}>
          <ManageEvent code={code()} />
        </Match>
      </Switch>
    </>
  );
}
