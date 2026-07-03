/* @refresh reload */
import { lazy } from 'solid-js';
import { render } from 'solid-js/web';
import { Route, Router } from '@solidjs/router';

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
const PlayersIndexPage = lazy(() => import('./pages/PlayersIndexPage').then(m => ({ default: m.PlayersIndexPage })));
const PlayerPage = lazy(() => import('./pages/PlayerPage').then(m => ({ default: m.PlayerPage })));
const PlayersPage = lazy(() => import('./pages/PlayersPage').then(m => ({ default: m.PlayersPage })));
const PlayerProfilePage = lazy(() => import('./pages/PlayerProfilePage').then(m => ({ default: m.PlayerProfilePage })));
const ToysPage = lazy(() => import('./pages/ToysPage').then(m => ({ default: m.ToysPage })));
const SocialGraphicsPage = lazy(() =>
  import('./pages/SocialGraphicsPage').then(m => ({ default: m.SocialGraphicsPage }))
);
const InLovingMemoryPage = lazy(() =>
  import('./pages/InLovingMemoryPage').then(m => ({ default: m.InLovingMemoryPage }))
);
const AboutPage = lazy(() => import('./pages/AboutPage').then(m => ({ default: m.AboutPage })));
const SurveyPage = lazy(() => import('./pages/SurveyPage').then(m => ({ default: m.SurveyPage })));
const SurveyResultsPage = lazy(() => import('./pages/SurveyResultsPage').then(m => ({ default: m.SurveyResultsPage })));

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Missing #root element in index.html');
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
      <Route path='/players/:id' component={PlayerProfilePage} />
      <Route path='/standings' component={PlayersIndexPage} />
      <Route path='/standings/:id' component={PlayerPage} />
      <Route path='/toys' component={ToysPage} />
      <Route path='/toys/social-graphics' component={SocialGraphicsPage} />
      <Route path='/toys/in-loving-memory' component={InLovingMemoryPage} />
      <Route path='/about' component={AboutPage} />
      <Route path='/survey' component={SurveyPage} />
      <Route path='/survey/results' component={SurveyResultsPage} />
      <Route path='*' component={NotFoundPage} />
    </Router>
  ),
  rootEl
);
