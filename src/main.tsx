/* @refresh reload */
import { type Component, lazy } from 'solid-js';
import { render } from 'solid-js/web';
import { Navigate, Route, Router, useParams } from '@solidjs/router';

import './styles/fonts.css';
import './styles/tokens.css';
import './styles/global.css';
import './styles/components.css';

import { App } from './app';
// HomePage stays eager: it's the most common landing route, and keeping it in
// the entry chunk saves a round trip for first-time visitors. Everything else
// is code-split so e.g. SocialGraphics (modern-screenshot) and the players
// pages never tax a visitor who only reads card stats (P1.3).
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { installPreloadRecovery } from './lib/preloadRecovery';
import { probeR2Ready } from './components/CardImage';
import { initTheme } from './lib/theme';
import { configurePrefetch } from './lib/prefetch';
import { loadArchetypeIconMap } from './lib/data/archetypes';

// A deploy replaces every content-hashed chunk, so a tab that predates it will
// fail the next lazy route's preload. Recover before any route can hit it.
installPreloadRecovery();

// Warm the image origin marker at startup. The synonym database is intentionally
// demand-loaded by card-facing data fetches; most routes never need its payload.
probeR2Ready();
loadArchetypeIconMap().catch(error => console.warn(error));

const routeLoaders: Record<string, () => Promise<unknown>> = {
  '/cards': () => import('./pages/CardsIndexPage'),
  '/cards/:set/:number': () => import('./pages/CardPage'),
  '/archetypes': () => import('./pages/ArchetypesIndexPage'),
  '/archetypes/:slug': () => import('./pages/ArchetypePage'),
  '/events/majors': () => import('./pages/TournamentsIndexPage'),
  '/trends': () => import('./pages/TrendsPage'),
  '/players': () => import('./pages/PlayersPage'),
  '/players/:id': () => import('./pages/PlayerProfilePage'),
  '/events/locator': () => import('./pages/EventLocatorPage'),
  '/about': () => import('./pages/AboutPage'),
  '/feedback': () => import('./pages/FeedbackPage')
};

configurePrefetch(routeLoaders);

// Each page module exports its component by name; lazy() wants a default.
function page<K extends string>(load: () => Promise<Record<K, Component>>, name: K): Component {
  return lazy(() => load().then(m => ({ default: m[name] })));
}

const CardsIndexPage = page(() => import('./pages/CardsIndexPage'), 'CardsIndexPage');
const CardPage = page(() => import('./pages/CardPage'), 'CardPage');
const ArchetypesIndexPage = page(() => import('./pages/ArchetypesIndexPage'), 'ArchetypesIndexPage');
const ArchetypePage = page(() => import('./pages/ArchetypePage'), 'ArchetypePage');
const TournamentsIndexPage = page(() => import('./pages/TournamentsIndexPage'), 'TournamentsIndexPage');
const TrendsPage = page(() => import('./pages/TrendsPage'), 'TrendsPage');
const PlayersPage = page(() => import('./pages/PlayersPage'), 'PlayersPage');
const PlayerProfilePage = page(() => import('./pages/PlayerProfilePage'), 'PlayerProfilePage');
const PlayerComparePage = page(() => import('./pages/PlayerComparePage'), 'PlayerComparePage');
const EventLocatorPage = page(() => import('./pages/EventLocatorPage'), 'EventLocatorPage');
const ToolsPage = page(() => import('./pages/ToolsPage'), 'ToolsPage');
// Rides in the Tools chunk: its own chunk would add a preload entry to the app shell, which has no room for one.
const BotPage = page(() => import('./pages/ToolsPage'), 'BotPage');
const SocialGraphicsPage = page(() => import('./pages/SocialGraphicsPage'), 'SocialGraphicsPage');
const InLovingMemoryPage = page(() => import('./pages/InLovingMemoryPage'), 'InLovingMemoryPage');
const LabelMakerPage = page(() => import('./pages/LabelMakerPage'), 'LabelMakerPage');
const MetaBinderPage = page(() => import('./pages/MetaBinderPage'), 'MetaBinderPage');
const TierListPage = page(() => import('./pages/TierListPage'), 'TierListPage');
const CardWallPage = page(() => import('./pages/CardWallPage'), 'CardWallPage');
const EarningsPage = page(() => import('./pages/EarningsPage'), 'EarningsPage');
const PackEvPage = page(() => import('./pages/PackEvPage'), 'PackEvPage');
const SetImpactPage = page(() => import('./pages/SetImpactPage'), 'SetImpactPage');
const LivePage = page(() => import('./pages/LivePage'), 'LivePage');
const LiveSeatPage = page(() => import('./pages/live/LiveSeatPage'), 'LiveSeatPage');
const AboutPage = page(() => import('./pages/AboutPage'), 'AboutPage');
const FeedbackPage = page(() => import('./pages/FeedbackPage'), 'FeedbackPage');
// Unlinked reference route: the design system rendered through the real
// stylesheets, so it can't drift from them. Kept out of the nav and the
// sitemap (static/robots.txt) — it's for building, not reading.
const StyleGuidePage = page(() => import('./pages/StyleGuidePage'), 'StyleGuidePage');

// Moved routes keep their query: /events?near=… and /tournaments?scope=… links
// are out in the wild.
function redirectKeepingQuery(to: string) {
  return () => <Navigate href={({ location }) => `${to}${location.search}`} />;
}

// Legacy /standings/:id links redirect to the equivalent /players/:id profile.
function StandingsPlayerRedirect() {
  const params = useParams();
  return <Navigate href={`/players/${params.id}`} />;
}

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Missing #root element in index.html');
}

// Service worker (P3.3): stale-while-revalidate for report JSON, cache-first
// for hashed assets/fonts, offline shell fallback. Production only — in dev it
// would mask HMR and serve stale modules.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* SW is a progressive enhancement; the site works fine without it */
    });
  });
}

// Before render: an attribute swap after first paint is a visible flash.
initTheme();

render(
  () => (
    <Router root={App}>
      <Route path='/' component={HomePage} />
      <Route path='/cards' component={CardsIndexPage} />
      <Route path='/cards/:set/:number' component={CardPage} />
      <Route path='/archetypes' component={ArchetypesIndexPage} />
      <Route path='/archetypes/:slug' component={ArchetypePage} />
      <Route path='/tournaments' component={redirectKeepingQuery('/events/majors')} />
      <Route path='/trends' component={TrendsPage} />
      <Route path='/players' component={PlayersPage} />
      <Route path='/players/compare' component={PlayerComparePage} />
      <Route path='/players/:id' component={PlayerProfilePage} />
      <Route path='/standings' component={() => <Navigate href='/players' />} />
      <Route path='/standings/:id' component={StandingsPlayerRedirect} />
      <Route path='/live/:slug' component={LivePage} />
      <Route path='/live/:slug/player/:seat' component={LiveSeatPage} />
      <Route path='/events' component={redirectKeepingQuery('/events/locator')} />
      <Route path='/events/majors' component={TournamentsIndexPage} />
      <Route path='/events/locator' component={EventLocatorPage} />
      <Route path='/tools' component={ToolsPage} />
      <Route path='/bot' component={BotPage} />
      <Route path='/tools/social-graphics' component={SocialGraphicsPage} />
      <Route path='/tools/in-loving-memory' component={InLovingMemoryPage} />
      <Route path='/tools/deck-box-labels' component={LabelMakerPage} />
      <Route path='/tools/meta-binder' component={MetaBinderPage} />
      <Route path='/tools/card-wall' component={CardWallPage} />
      <Route path='/tools/tier-list' component={TierListPage} />
      <Route path='/tools/earnings' component={EarningsPage} />
      <Route path='/tools/pack-ev' component={PackEvPage} />
      <Route path='/tools/set-impact' component={SetImpactPage} />
      {/* The section shipped as /toys before it was made public — keep the old
          paths working for anyone who bookmarked or shared one. */}
      <Route path='/toys' component={() => <Navigate href='/tools' />} />
      <Route path='/toys/social-graphics' component={() => <Navigate href='/tools/social-graphics' />} />
      <Route path='/toys/in-loving-memory' component={() => <Navigate href='/tools/in-loving-memory' />} />
      <Route path='/about' component={AboutPage} />
      <Route path='/feedback' component={FeedbackPage} />
      <Route path='/style' component={StyleGuidePage} />
      <Route path='*' component={NotFoundPage} />
    </Router>
  ),
  rootEl
);
