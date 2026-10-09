/**
 * /host signed in: the account's dashboard, one tab per part it plays.
 * Playing is every account's (its History, see PlayingTab); Organizing
 * belongs to an account that may start events or already runs or staffs one
 * (the organizer's lists, see HostIndex); Admin to an Admin (the
 * Applications queue). With one tab there is no switch, only its name.
 *
 * The tabs are the page's heading on a wide screen, beside the account menu;
 * on a phone they move to a bar along the bottom of the screen, and the
 * heading is the open tab's name. The open tab is kept in the address. With
 * none asked for, an event running now opens its tab, then an organizer's
 * events, then Playing.
 */

import { A, useSearchParams } from '@solidjs/router';
import {
  createEffect,
  createResource,
  createSignal,
  For,
  type JSX,
  lazy,
  Match,
  type Resource,
  Show,
  Switch,
  untrack
} from 'solid-js';
import type { MyApplication } from '../../../shared/accounts/types';
import { isAdmin } from '../../../shared/accounts/roles';
import { canCreateEvents } from '../../../shared/accounts/stores';
import { Skeleton } from '../../components/Skeleton';
import { fetchHistory, listTournaments, type Me, type TournamentSummary } from '../../lib/tournament/api';
import { fetchApplications } from '../../lib/tournament/admin';
import { applicantStage, fetchApplication } from '../../lib/tournament/applications';
import { latestValue } from '../../lib/resource';
import { AccountMenu } from './AccountMenu';
import { createSessionCatchUp } from './ApplicantStatus';
import { PlayingTab } from './PlayingTab';
import '../../styles/pages/tournament-dashboard.css';

const AdminApplications = lazy(() => import('./AdminApplications').then(m => ({ default: m.AdminApplications })));

export type Tab = 'playing' | 'organizing' | 'admin';

const LABELS: Record<Tab, string> = { playing: 'Playing', organizing: 'Organizing', admin: 'Admin' };

const ICONS: Record<Tab, JSX.Element> = {
  playing: (
    <svg viewBox='0 0 24 24' aria-hidden='true'>
      <rect x='5' y='3' width='14' height='18' rx='2' />
      <path d='M9 8h6M9 12h6' />
    </svg>
  ),
  organizing: (
    <svg viewBox='0 0 24 24' aria-hidden='true'>
      <rect x='3' y='5' width='18' height='16' rx='2' />
      <path d='M3 10h18M8 3v4M16 3v4' />
    </svg>
  ),
  admin: (
    <svg viewBox='0 0 24 24' aria-hidden='true'>
      <path d='M12 3l8 4v5c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V7z' />
    </svg>
  )
};

interface Shown {
  tab: Tab;
  count: number;
}

const settled = (resource: Resource<unknown>) => resource.state === 'ready' || resource.state === 'errored';

/**
 * The tabs, as a strip under the heading (`wide`) or the phone's bottom bar;
 * only one shows at a time. The arrow keys, Home and End move between them.
 */
function TabList(props: { shown: Shown[]; tab: Tab; onSelect: (tab: Tab) => void; wide: boolean }) {
  let list: HTMLDivElement | undefined;
  const id = (tab: Tab) => `tm-dash-${props.wide ? 'tab' : 'bar'}-${tab}`;
  function key(event: KeyboardEvent) {
    const steps: Record<string, (i: number, n: number) => number> = {
      ArrowRight: (i, n) => (i + 1) % n,
      ArrowLeft: (i, n) => (i + n - 1) % n,
      Home: () => 0,
      End: (_i, n) => n - 1
    };
    const step = steps[event.key];
    if (!step) {
      return;
    }
    event.preventDefault();
    const next =
      props.shown[
        step(
          props.shown.findIndex(s => s.tab === props.tab),
          props.shown.length
        )
      ];
    if (next) {
      props.onSelect(next.tab);
      list?.querySelector<HTMLElement>(`#${id(next.tab)}`)?.focus();
    }
  }
  return (
    <div
      ref={list}
      class={props.wide ? 'tm-dash-tabs tm-dash-wide' : 'tm-dash-bar tm-dash-phone'}
      role='tablist'
      aria-label='Dashboard'
      onKeyDown={key}
    >
      <For each={props.shown}>
        {s => (
          <button
            type='button'
            role='tab'
            id={id(s.tab)}
            aria-selected={s.tab === props.tab}
            aria-controls='tm-dash-panel'
            tabIndex={s.tab === props.tab ? 0 : -1}
            onClick={() => props.onSelect(s.tab)}
          >
            <Show when={!props.wide}>{ICONS[s.tab]}</Show>
            <span>
              {LABELS[s.tab]}
              <Show when={s.count > 0}>
                <span class='tm-dash-count'>{s.count}</span>
              </Show>
            </span>
          </button>
        )}
      </For>
    </div>
  );
}

export function Dashboard(props: {
  user: Me;
  organizing: (events: readonly TournamentSummary[], application: Resource<MyApplication | null>) => JSX.Element;
}) {
  const [params, setParams] = useSearchParams<{ tab?: string; new?: string }>();
  const [events] = createResource(() => listTournaments().then(answer => answer.tournaments));
  const [history, { refetch }] = createResource(() => fetchHistory().then(answer => answer.entries));
  const admin = () => isAdmin(props.user.role);
  const [pending] = createResource(admin, () =>
    fetchApplications('pending').then(answer => answer.applications.length)
  );

  const runningNow = () => (latestValue(events) ?? []).filter(event => !event.finished && event.rounds > 0).length;
  // A History unread for an error counts nothing here; the Playing tab says why.
  const playingNow = () => (history.error ? [] : (latestValue(history) ?? [])).filter(e => e.status === 'live').length;
  const mayCreate = () => canCreateEvents(props.user.role, props.user.stores);
  // An account that may not start events is asked where its Application stands: one under way
  // shows the Organizing tab, where ApplicantLine says so, and one approved since the session
  // was read has the session read again.
  const [application] = createResource(
    () => !mayCreate(),
    () => fetchApplication().then(answer => answer.application)
  );
  createSessionCatchUp(
    () => props.user.role,
    () => latestValue(application)
  );
  const applied = () => !mayCreate() && applicantStage(props.user.role, latestValue(application) ?? null) !== 'none';
  const organizes = () => mayCreate() || applied() || (latestValue(events) ?? []).length > 0;

  const shown = (): Shown[] => [
    { tab: 'playing', count: playingNow() },
    ...(organizes() ? [{ tab: 'organizing' as const, count: runningNow() }] : []),
    ...(admin() ? [{ tab: 'admin' as const, count: latestValue(pending) ?? 0 }] : [])
  ];
  /** The tab to open with none asked for: a running event's, then a match being played, then an organizer's events. */
  const fallbackTab = (): Tab => {
    if (params.new || runningNow() > 0) {
      return organizes() ? 'organizing' : 'playing';
    }
    return playingNow() === 0 && organizes() ? 'organizing' : 'playing';
  };
  // Which tabs there are, and which opens, waits on everything that decides them; once chosen,
  // the opening tab holds, so nothing read later moves the page out from under someone.
  const ready = () => settled(events) && settled(history) && (mayCreate() || settled(application));
  const [opening, setOpening] = createSignal<Tab | null>(null);
  createEffect(() => {
    if (opening() === null && ready()) {
      setOpening(untrack(fallbackTab));
    }
  });
  const tab = (): Tab | null => shown().find(s => s.tab === params.tab)?.tab ?? opening();
  const select = (next: Tab) => setParams({ tab: next }, { replace: true });

  createEffect(() => {
    const open = tab();
    if (open) {
      document.title = `${LABELS[open]} — Ciphermaniac`;
    }
  });

  return (
    <Show when={opening() && tab()} fallback={<Skeleton height='200px' />}>
      {open => (
        <div class='tm-dash' classList={{ 'tm-dash-barred': shown().length > 1 }}>
          <header class='tm-dash-head'>
            <Show when={shown().length > 1} fallback={<h1 class='tm-dash-title'>{LABELS[open()]}</h1>}>
              <h1 class='tm-dash-title tm-dash-phone'>{LABELS[open()]}</h1>
              <TabList shown={shown()} tab={open()} onSelect={select} wide />
            </Show>
            <AccountMenu user={props.user} pending={latestValue(pending) ?? 0} />
          </header>
          <Show when={shown().length > 1}>
            <TabList shown={shown()} tab={open()} onSelect={select} wide={false} />
          </Show>
          <div id='tm-dash-panel' role='tabpanel' aria-label={LABELS[open()]}>
            <Switch>
              <Match when={open() === 'playing'}>
                <PlayingTab history={history} onRetry={() => void refetch()} />
              </Match>
              <Match when={open() === 'organizing'}>{props.organizing(latestValue(events) ?? [], application)}</Match>
              <Match when={open() === 'admin'}>
                <AdminApplications />
                <p class='tm-dash-more'>
                  <A href='/admin'>Organizers and POP IDs</A>
                </p>
              </Match>
            </Switch>
          </div>
        </div>
      )}
    </Show>
  );
}
