import { A } from '@solidjs/router';
import { onMount } from 'solid-js';

export function NotFoundPage() {
  onMount(() => {
    document.title = 'Not found — Ciphermaniac';
  });

  return (
    <section>
      <div class='empty-state'>
        <div class='empty-state-mark' aria-hidden='true'>
          <svg
            viewBox='0 0 24 24'
            width='22'
            height='22'
            fill='none'
            stroke='currentColor'
            stroke-width='1.5'
            stroke-linecap='round'
            stroke-linejoin='round'
          >
            <circle cx='12' cy='12' r='9' />
            <path d='M9 9 l6 6 M15 9 l-6 6' />
          </svg>
        </div>
        <h4>404 — page not found.</h4>
        <p>That route doesn't exist (yet). Most of the app is still being scaffolded.</p>
        <div class='empty-state-actions'>
          <A href='/' class='btn btn-primary'>
            Back to home
          </A>
        </div>
      </div>
    </section>
  );
}
