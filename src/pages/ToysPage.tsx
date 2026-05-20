import { onMount } from 'solid-js';
import { A } from '@solidjs/router';
import { EmptyState } from '../components/EmptyState';

export function ToysPage() {
  onMount(() => {
    document.title = 'Toys — Ciphermaniac';
  });

  return (
    <>
      <section class='hero'>
        <h1>Toys</h1>
        <div class='hero-meta'>
          <span>Experimental tools — coming back soon</span>
        </div>
      </section>

      <section>
        <EmptyState
          title='The toys hub is on the way back.'
          description='Meta binder, in-loving-memory archetype archive, player-connection graph, and the tournament social-graphics generator will return as the frontend rebuild lands them. The data and Functions for these still exist; just no UI yet.'
          actions={
            <A href='/' class='btn btn-secondary'>
              Back home
            </A>
          }
        />
      </section>
    </>
  );
}
