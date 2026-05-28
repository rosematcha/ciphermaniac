/* @refresh reload */
import { render } from 'solid-js/web';
import { Route, Router } from '@solidjs/router';

import './styles/tokens.css';
import './styles/global.css';
import './styles/components.css';

import { App } from './app';
import { HomePage } from './pages/HomePage';
import { CardsIndexPage } from './pages/CardsIndexPage';
import { CardPage } from './pages/CardPage';
import { ArchetypesIndexPage } from './pages/ArchetypesIndexPage';
import { ArchetypePage } from './pages/ArchetypePage';
import { TournamentsIndexPage } from './pages/TournamentsIndexPage';
import { TrendsPage } from './pages/TrendsPage';
import { PlayersIndexPage } from './pages/PlayersIndexPage';
import { PlayerPage } from './pages/PlayerPage';
import { PlayersPage } from './pages/PlayersPage';
import { PlayerProfilePage } from './pages/PlayerProfilePage';
import { ToysPage } from './pages/ToysPage';
import { SocialGraphicsPage } from './pages/SocialGraphicsPage';
import { InLovingMemoryPage } from './pages/InLovingMemoryPage';
import { AboutPage } from './pages/AboutPage';
import { NotFoundPage } from './pages/NotFoundPage';

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
      <Route path='*' component={NotFoundPage} />
    </Router>
  ),
  rootEl
);
