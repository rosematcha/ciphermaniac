import { onMount } from 'solid-js';
import { A } from '@solidjs/router';

export function ToolsPage() {
  onMount(() => {
    document.title = 'Tools — Ciphermaniac';
  });

  return (
    <>
      <section class='hero'>
        <h1>Tools</h1>
        <div class='hero-meta'>
          <span>Make a graphic, print a label, or read the archive</span>
        </div>
      </section>

      <section>
        <div class='gallery-grid'>
          <A class='arche' href='/tools/social-graphics'>
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

          <A class='arche' href='/tools/deck-box-labels'>
            <div class='arche-thumb' aria-hidden='true'>
              <svg viewBox='0 0 100 80'>
                <rect
                  x='6'
                  y='22'
                  width='88'
                  height='36'
                  rx='2'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                  opacity='0.45'
                />
                <circle cx='24' cy='40' r='9' fill='currentColor' opacity='0.42' />
                <rect x='40' y='31' width='42' height='7' fill='currentColor' opacity='0.5' />
                <rect x='40' y='42' width='26' height='5' fill='currentColor' opacity='0.28' />
              </svg>
            </div>
            <div class='arche-name'>Deck Box Label Maker</div>
            <div class='arche-stats'>
              <span class='arche-wr'>Design a deck box label and print it on a thermal label printer</span>
            </div>
          </A>

          <A class='arche' href='/tools/in-loving-memory'>
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
