/**
 * Every tournament route through one entry in main.tsx: /host (an
 * organizer's events), /host/:code (running one), /t/:code (the public page
 * players follow), /settings (sign-in, sign-out and the player profile;
 * /account is its older name), /history (the events an account played),
 * /u/:handle (an account's public profile), /apply (applying to run events),
 * /welcome (a new sign-up's age check), /admin (an Admin's page), and a
 * store's /stores/:id (its public page), /stores/:id/settings and
 * /stores/join (its invite links).
 * One route rather than one each, because each route added to main.tsx is
 * paid for in the app shell; each page is still its own chunk, so a player
 * following pairings never downloads the organizer's console.
 */

import { useLocation, useParams } from '@solidjs/router';
import { lazy, Match, Show, Switch } from 'solid-js';
import '../styles/pages/tournament.css';
import { latestValue } from '../lib/resource';
import { preloadPublished } from '../lib/tournament/api';
import { AccountStrip } from './tournaments/AccountStrip';
import { session } from './tournaments/session';

const SettingsPage = lazy(() => import('./tournaments/SettingsPage').then(m => ({ default: m.SettingsPage })));
const HostIndex = lazy(() => import('./tournaments/HostIndex').then(m => ({ default: m.HostIndex })));
const ManageEvent = lazy(() => import('./tournaments/ManageEvent').then(m => ({ default: m.ManageEvent })));
const PublicEvent = lazy(() => import('./tournaments/PublicEvent').then(m => ({ default: m.PublicEvent })));
const HistoryPage = lazy(() => import('./tournaments/HistoryPage').then(m => ({ default: m.HistoryPage })));
const ProfilePage = lazy(() => import('./tournaments/ProfilePage').then(m => ({ default: m.ProfilePage })));
const ApplyPage = lazy(() => import('./tournaments/ApplyPage').then(m => ({ default: m.ApplyPage })));
const WelcomePage = lazy(() => import('./tournaments/WelcomePage').then(m => ({ default: m.WelcomePage })));
const AdminPage = lazy(() => import('./tournaments/AdminPage').then(m => ({ default: m.AdminPage })));
const StoreRoutes = lazy(() => import('./tournaments/StoreRoutes').then(m => ({ default: m.StoreRoutes })));

// A page opened on an event asks for it now, as this module loads, so the event and the
// public page's own code arrive side by side instead of one after the other.
const opened = /^\/t\/(\w+)/.exec(window.location.pathname)?.[1];
if (opened) {
  preloadPublished(opened.toUpperCase());
}

export function TournamentsPage() {
  const location = useLocation();
  const params = useParams<{ code?: string; handle?: string }>();
  const code = () => (params.code ?? '').toUpperCase();
  const screen = () => new URLSearchParams(location.search).get('screen') === '1';
  const settings = () => location.pathname.startsWith('/account') || location.pathname.startsWith('/settings');
  // Nobody is signed in yet at the age check, and its only way on is the form.
  const welcome = () => location.pathname.startsWith('/welcome');
  return (
    <>
      {/* Settings shows who is signed in itself. */}
      <Show when={!screen() && !settings() && !welcome()}>
        <AccountStrip />
      </Show>
      <Switch fallback={<HostIndex />}>
        <Match when={settings()}>
          <SettingsPage />
        </Match>
        <Match when={location.pathname.startsWith('/history')}>
          <HistoryPage />
        </Match>
        <Match when={location.pathname.startsWith('/apply')}>
          <ApplyPage />
        </Match>
        <Match when={welcome()}>
          <WelcomePage />
        </Match>
        <Match when={location.pathname.startsWith('/admin')}>
          <AdminPage />
        </Match>
        <Match when={location.pathname.startsWith('/stores/')}>
          <StoreRoutes />
        </Match>
        <Match when={location.pathname.startsWith('/u/') && params.handle}>
          {handle => <ProfilePage handle={handle().toLowerCase()} />}
        </Match>
        <Match when={location.pathname.startsWith('/t/') && code()}>
          <PublicEvent code={code()} session={latestValue(session)} />
        </Match>
        <Match when={location.pathname.startsWith('/host/') && code()}>
          <ManageEvent code={code()} />
        </Match>
      </Switch>
    </>
  );
}
