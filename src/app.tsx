import { ErrorBoundary, type ParentComponent, Suspense } from 'solid-js';
import { useIsRouting } from '@solidjs/router';
import { SurveyBanner } from './components/SurveyBanner';
import { Skeleton } from './components/Skeleton';
import { TopNav } from './components/TopNav';
import { TournamentProvider } from './lib/tournamentContext';

/**
 * Fallback while a lazy route chunk downloads on a cold load (page data never
 * suspends — pages read resources via lib/resource.ts and render their own
 * skeletons). Generic on purpose: it only shows for the beat before the
 * page's real skeleton takes over.
 */
function ChunkFallback() {
  return (
    <section class='hero' aria-hidden='true'>
      <Skeleton width='220px' height='28px' />
      <div class='hero-meta'>
        <Skeleton width='320px' height='13px' />
      </div>
    </section>
  );
}

/**
 * Root layout. Every route renders inside this — TopNav always shows,
 * and the tournament context is available everywhere underneath. The
 * ErrorBoundary catches any thrown render error in a page so a single bad
 * page doesn't take down the whole SPA.
 */
export const App: ParentComponent = props => {
  const isRouting = useIsRouting();
  return (
    <TournamentProvider>
      {/* Slim pending bar: instant feedback the moment a nav starts, for the
          cases that still take time (lazy chunk download on slow networks). */}
      <div class='route-progress' classList={{ active: isRouting() }} aria-hidden='true' />
      <SurveyBanner />
      <TopNav />
      <main class='page'>
        <ErrorBoundary
          fallback={(err, reset) => (
            <section class='error-fallback' role='alert'>
              <h1>Something went wrong</h1>
              <p>This page hit an unexpected error. The rest of the site should still work.</p>
              <pre class='muted'>{err instanceof Error ? err.message : String(err)}</pre>
              <button type='button' onClick={reset}>
                Try again
              </button>
            </section>
          )}
        >
          {/* Routes are code-split (lazy()) — this boundary only covers route
              chunk loading. Page DATA must never suspend (see lib/resource.ts):
              a suspending read during nav freezes the old page for the whole
              fetch, and on cold load would blank the main area. */}
          <Suspense fallback={<ChunkFallback />}>{props.children}</Suspense>
        </ErrorBoundary>
      </main>
    </TournamentProvider>
  );
};
