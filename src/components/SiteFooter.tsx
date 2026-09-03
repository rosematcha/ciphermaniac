/**
 * The strip under every page: where the site goes, who runs it, and the mode
 * toggle.
 *
 * The links are the nav's, plus Tournaments, which it has no room for — so the
 * footer doubles as the site's map on a phone, where the nav's Tools menu is
 * hidden. About is deliberately absent until that page is rewritten.
 * @module components/SiteFooter
 */

import { A } from '@solidjs/router';
import { For, type JSX } from 'solid-js';
import { prefetchRoute } from '../lib/prefetch';
import { type Mode, mode, setMode } from '../lib/theme';

const LINKS: { href: string; label: string }[] = [
  { href: '/cards', label: 'Cards' },
  { href: '/archetypes', label: 'Archetypes' },
  { href: '/tournaments', label: 'Tournaments' },
  { href: '/trends', label: 'Trends' },
  { href: '/players', label: 'Players' },
  { href: '/tools', label: 'Tools' }
];

export function SiteFooter(): JSX.Element {
  // The button names where it goes, not where you are — so it reads as the
  // thing it does rather than as a state you have to decode. That makes it an
  // action, not a toggle, which is why there is no `aria-pressed` here: a
  // control labelled "Light mode" while pressed would announce a contradiction.
  const next = (): Mode => (mode() === 'dark' ? 'light' : 'dark');
  return (
    <footer class='site-footer'>
      <nav class='site-footer-links' aria-label='Footer'>
        <For each={LINKS}>
          {link => (
            <A href={link.href} onMouseEnter={() => prefetchRoute(link.href)} onFocus={() => prefetchRoute(link.href)}>
              {link.label}
            </A>
          )}
        </For>
      </nav>
      <p class='site-footer-note'>
        Maintained by{' '}
        <a href='https://x.com/dustoxgDP63' target='_blank' rel='noopener noreferrer'>
          @dustoxgDP63
        </a>
      </p>
      <button type='button' class='chip' aria-label={`Switch to ${next()} mode`} onClick={() => setMode(next())}>
        {next() === 'dark' ? 'Dark' : 'Light'} mode
      </button>
    </footer>
  );
}
