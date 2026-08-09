import { onMount } from 'solid-js';
import { A } from '@solidjs/router';

export function ToysPage() {
  onMount(() => {
    document.title = 'Toys — Ciphermaniac';
  });

  return (
    <>
      <section class='hero'>
        <h1>Toys</h1>
        <div class='hero-meta'>
          <span>Experimental tools built on top of the tournament data</span>
        </div>
      </section>

      <section>
        <div class='gallery-grid'>
          <A class='arche' href='/toys/social-graphics'>
            <div class='arche-thumb' aria-hidden='true'>
              <svg viewBox='0 0 100 80'>
                <rect x='8' y='14' width='84' height='52' rx='3' fill='currentColor' opacity='0.18' />
                <rect x='14' y='20' width='34' height='40' fill='currentColor' opacity='0.5' />
                <rect x='52' y='20' width='34' height='12' fill='currentColor' opacity='0.35' />
                <rect x='52' y='36' width='34' height='8' fill='currentColor' opacity='0.25' />
                <rect x='52' y='48' width='34' height='12' fill='currentColor' opacity='0.35' />
              </svg>
            </div>
            <div class='arche-name'>Social Graphics</div>
            <div class='arche-stats'>
              <span class='arche-wr'>Build a shareable top-cards graphic from any tournament report</span>
            </div>
          </A>

          <A class='arche' href='/toys/in-loving-memory'>
            <div class='arche-thumb' aria-hidden='true'>
              <svg viewBox='0 0 100 80'>
                <path
                  d='M50 18 C42 8, 24 8, 22 22 C20 36, 50 60, 50 60 C50 60, 80 36, 78 22 C76 8, 58 8, 50 18 Z'
                  fill='currentColor'
                  opacity='0.32'
                />
              </svg>
            </div>
            <div class='arche-name'>In Loving Memory</div>
            <div class='arche-stats'>
              <span class='arche-wr'>Every Day-2 decklist from rotated archetypes, frozen at the end of their run</span>
            </div>
          </A>
        </div>
      </section>
    </>
  );
}
