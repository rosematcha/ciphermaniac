import { A, useLocation } from '@solidjs/router';
import { For, Show } from 'solid-js';
import { TournamentSelector } from './TournamentSelector';
import { prefetchRoute } from '../lib/prefetch';

type NavLink = { href: string; label: string; menu?: { href: string; label: string }[] };

const links: NavLink[] = [
  { href: '/cards', label: 'Cards' },
  { href: '/archetypes', label: 'Archetypes' },
  { href: '/trends', label: 'Trends' },
  { href: '/players', label: 'Players' },
  {
    href: '/tools',
    label: 'Tools',
    // Shortcut to the two tools worth deep-linking. Desktop hover only; on
    // phones the menu is hidden and /tools does the work.
    menu: [
      { href: '/tools/tier-list', label: 'Tier List Maker' },
      { href: '/tools/deck-box-labels', label: 'Deck Box Label Maker' }
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
    <header class='topnav'>
      <A href='/' class='topnav-word'>
        Ciphermaniac
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
      </nav>
      <div class='topnav-actions'>
        <TournamentSelector />
      </div>
    </header>
  );
}
