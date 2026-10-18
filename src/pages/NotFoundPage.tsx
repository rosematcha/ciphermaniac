import { A } from '@solidjs/router';
import { onMount } from 'solid-js';
import { ErrorState } from '@ciphermaniac/design/components/ErrorState';

export function NotFoundPage() {
  onMount(() => {
    document.title = 'Not found — Ciphermaniac';
  });

  return (
    <ErrorState
      code='404'
      title='Page not found'
      line="That route doesn't exist (yet). Most of the app is still being scaffolded."
    >
      <A href='/' class='btn btn-primary'>
        Back to home
      </A>
    </ErrorState>
  );
}
