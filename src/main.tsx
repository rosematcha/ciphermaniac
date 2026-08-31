/* @refresh reload */
import { lazy } from 'solid-js';
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

// A deploy replaces every content-hashed chunk, so a tab that predates it will
// fail the next lazy route's preload. Recover before any route can hit it.
installPreloadRecovery();

// Warm the image origin marker at startup. The synonym database is intentionally
// demand-loaded by card-facing data fetches; most routes never need its payload.
probeR2Ready();

const CardsIndexPage = lazy(() => import('./pages/CardsIndexPage').then(m => ({ default: m.CardsIndexPage })));
const CardPage = lazy(() => import('./pages/CardPage').then(m => ({ default: m.CardPage })));
const ArchetypesIndexPage = lazy(() =>
  import('./pages/ArchetypesIndexPage').then(m => ({ default: m.ArchetypesIndexPage }))
);
const ArchetypePage = lazy(() => import('./pages/ArchetypePage').then(m => ({ default: m.ArchetypePage })));
const TournamentsIndexPage = lazy(() =>
  import('./pages/TournamentsIndexPage').then(m => ({ default: m.TournamentsIndexPage }))
);
const TrendsPage = lazy(() => import('./pages/TrendsPage').then(m => ({ default: m.TrendsPage })));
const PlayersPage = lazy(() => import('./pages/PlayersPage').then(m => ({ default: m.PlayersPage })));
const PlayerProfilePage = lazy(() => import('./pages/PlayerProfilePage').then(m => ({ default: m.PlayerProfilePage })));
const PlayerComparePage = lazy(() => import('./pages/PlayerComparePage').then(m => ({ default: m.PlayerComparePage })));
const ToolsPage = lazy(() => import('./pages/ToolsPage').then(m => ({ default: m.ToolsPage })));
const SocialGraphicsPage = lazy(() =>
  import('./pages/SocialGraphicsPage').then(m => ({ default: m.SocialGraphicsPage }))
);
const InLovingMemoryPage = lazy(() =>
  import('./pages/InLovingMemoryPage').then(m => ({ default: m.InLovingMemoryPage }))
);
const LabelMakerPage = lazy(() => import('./pages/LabelMakerPage').then(m => ({ default: m.LabelMakerPage })));
const MetaBinderPage = lazy(() => import('./pages/MetaBinderPage').then(m => ({ default: m.MetaBinderPage })));
const CardWallPage = lazy(() => import('./pages/CardWallPage').then(m => ({ default: m.CardWallPage })));
const AboutPage = lazy(() => import('./pages/AboutPage').then(m => ({ default: m.AboutPage })));
const SurveyPage = lazy(() => import('./pages/SurveyPage').then(m => ({ default: m.SurveyPage })));
const SurveyResultsPage = lazy(() => import('./pages/SurveyResultsPage').then(m => ({ default: m.SurveyResultsPage })));

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

// Default to light unless the user has previously picked dark.
const savedMode = (typeof localStorage !== 'undefined' && localStorage.getItem('cm:mode')) as 'light' | 'dark' | null;
document.body.dataset.mode = savedMode ?? 'light';

render(
  () => (
    <Router root={App}>
      <Route path='/' component={HomePage} />
      <Route path='/cards' component={CardsIndexPage} />
      <Route path='/cards/:set/:number' component={CardPage} />
      <Route path='/archetypes' component={ArchetypesIndexPage} />
      <Route path='/archetypes/:slug' component={ArchetypePage} />
      <Route path='/tournaments' component={TournamentsIndexPage} />
      <Route path='/trends' component={TrendsPage} />
      <Route path='/players' component={PlayersPage} />
      <Route path='/players/compare' component={PlayerComparePage} />
      <Route path='/players/:id' component={PlayerProfilePage} />
      <Route path='/standings' component={() => <Navigate href='/players' />} />
      <Route path='/standings/:id' component={StandingsPlayerRedirect} />
      <Route path='/tools' component={ToolsPage} />
      <Route path='/tools/social-graphics' component={SocialGraphicsPage} />
      <Route path='/tools/in-loving-memory' component={InLovingMemoryPage} />
      <Route path='/tools/deck-box-labels' component={LabelMakerPage} />
      <Route path='/tools/meta-binder' component={MetaBinderPage} />
      <Route path='/tools/card-wall' component={CardWallPage} />
      {/* The section shipped as /toys before it was made public — keep the old
          paths working for anyone who bookmarked or shared one. */}
      <Route path='/toys' component={() => <Navigate href='/tools' />} />
      <Route path='/toys/social-graphics' component={() => <Navigate href='/tools/social-graphics' />} />
      <Route path='/toys/in-loving-memory' component={() => <Navigate href='/tools/in-loving-memory' />} />
      <Route path='/about' component={AboutPage} />
      <Route path='/survey' component={SurveyPage} />
      <Route path='/survey/results' component={SurveyResultsPage} />
      <Route path='*' component={NotFoundPage} />
    </Router>
  ),
  rootEl
);
