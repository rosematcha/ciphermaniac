import { A, useLocation } from '@solidjs/router';
import { For, Show } from 'solid-js';
import { GlobalSearch } from './GlobalSearch';
import { TournamentSelector } from './TournamentSelector';
import { EVENTS_SITE_URL, showEventsSite } from '../lib/flags';
import { prefetchRoute } from '../lib/prefetch';

type NavLink = {
  href: string;
  label: string;
  menu?: { href: string; label: string }[];
};

const links: NavLink[] = [
  { href: '/cards', label: 'Cards' },
  { href: '/archetypes', label: 'Archetypes' },
  { href: '/trends', label: 'Trends' },
  { href: '/players', label: 'Players' },
  {
    href: '/tools',
    label: 'Tools',
    // Shortcut to the headline tools, the same ones /tools gives tiles.
    // Desktop hover only; on phones the menu is hidden and /tools does the work.
    menu: [
      { href: '/tools/event-locator', label: 'Event Locator' },
      { href: '/tools/tier-list', label: 'Tier List Maker' },
      { href: '/tools/deck-box-labels', label: 'Deck Box Label Maker' },
      { href: '/tools/pack-ev', label: 'Pack EV' }
    ]
  }
];

export function TopNav() {
  const location = useLocation();

  const isActive = (href: string) => {
    const path = location.pathname;
    if (href === '/') {
      return path === '/';
    }
    // Match exact or child routes, but not accidental prefix overlap
    // (`/cards` should not light up on a hypothetical `/cardsXYZ`).
    return path === href || path.startsWith(`${href}/`);
  };

  return (
    <header class='topnav head-bar'>
      <A href='/' class='topnav-word'>
        <img class='topnav-logo' src='/logo.svg' alt='' width='20' height='24' />
        <span>Ciphermaniac</span>
      </A>
      <nav class='topnav-links' aria-label='Primary'>
        <For each={links}>
          {l => (
            <div class='topnav-item'>
              <A
                href={l.href}
                class='topnav-link'
                classList={{ active: isActive(l.href) }}
                onMouseEnter={() => prefetchRoute(l.href)}
                onFocus={() => prefetchRoute(l.href)}
              >
                {l.label}
              </A>
              <Show when={l.menu}>
                {menu => (
                  <div class='topnav-menu'>
                    <For each={menu()}>
                      {m => (
                        <A
                          href={m.href}
                          class='topnav-menu-link'
                          onMouseEnter={() => prefetchRoute(m.href)}
                          onFocus={() => prefetchRoute(m.href)}
                        >
                          {m.label}
                        </A>
                      )}
                    </For>
                  </div>
                )}
              </Show>
            </div>
          )}
        </For>
        {/* Events is its own site; the link goes out to it once it launches (lib/flags.ts). */}
        <Show when={showEventsSite}>
          <div class='topnav-item'>
            <a href={EVENTS_SITE_URL} class='topnav-link'>
              Events
            </a>
          </div>
        </Show>
      </nav>
      <div class='topnav-actions'>
        <GlobalSearch />
        <TournamentSelector />
      </div>
    </header>
  );
}
