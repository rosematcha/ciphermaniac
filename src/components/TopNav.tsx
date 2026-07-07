import { A, useLocation } from '@solidjs/router';
import { For } from 'solid-js';
import { TournamentSelector } from './TournamentSelector';
import { prefetchRoute } from '../lib/prefetch';

const links: { href: string; label: string }[] = [
  { href: '/cards', label: 'Cards' },
  { href: '/archetypes', label: 'Archetypes' },
  { href: '/matchups', label: 'Matchups' },
  { href: '/trends', label: 'Trends' },
  { href: '/players', label: 'Players' }
];

export function TopNav() {
  const location = useLocation();

  // --- Light/dark mode toggle: temporarily hidden site-wide. To restore, also
  // uncomment the `createSignal` import above and the button in the markup below.
  // `main.tsx` sets `document.body.dataset.mode` synchronously before render
  // from localStorage; read that here rather than hitting localStorage again.
  // const initialMode = ((document.body.dataset.mode as 'light' | 'dark' | undefined) ?? 'light') as 'light' | 'dark';
  // const [mode, setMode] = createSignal<'light' | 'dark'>(initialMode);
  //
  // function toggleMode() {
  //   const next = mode() === 'light' ? 'dark' : 'light';
  //   setMode(next);
  //   document.body.dataset.mode = next;
  //   try {
  //     localStorage.setItem('cm:mode', next);
  //   } catch {
  //     /* localStorage may be unavailable */
  //   }
  // }

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
            <A
              href={l.href}
              class='topnav-link'
              classList={{ active: isActive(l.href) }}
              onMouseEnter={() => prefetchRoute(l.href)}
              onFocus={() => prefetchRoute(l.href)}
            >
              {l.label}
            </A>
          )}
        </For>
      </nav>
      <div class='topnav-actions'>
        <TournamentSelector />
        {/* Light/dark mode toggle — temporarily hidden site-wide.
        <button
          class='topnav-mode-toggle'
          type='button'
          onClick={toggleMode}
          aria-label={`Switch to ${mode() === 'light' ? 'dark' : 'light'} mode`}
        >
          {mode() === 'light' ? 'Dark' : 'Light'}
        </button>
        */}
      </div>
    </header>
  );
}
