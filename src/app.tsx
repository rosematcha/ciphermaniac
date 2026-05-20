import { ErrorBoundary, type ParentComponent } from 'solid-js';
import { TopNav } from './components/TopNav';
import { TournamentProvider } from './lib/tournamentContext';

/**
 * Root layout. Every route renders inside this — TopNav always shows,
 * and the tournament context is available everywhere underneath. The
 * ErrorBoundary catches any thrown render error in a page so a single bad
 * page doesn't take down the whole SPA.
 */
export const App: ParentComponent = props => {
  return (
    <TournamentProvider>
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
          {props.children}
        </ErrorBoundary>
      </main>
    </TournamentProvider>
  );
};
