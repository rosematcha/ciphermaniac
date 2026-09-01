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
          <span>Print something for your shelf, or look back at decks that rotated out</span>
        </div>
      </section>

      <section>
        <div class='gallery-grid'>
          {/* Social Graphics (/tools/social-graphics) is deliberately not
              listed. The route still works for anyone with the link, but it's
              an internal export tool, so it stays out of the index, the
              sitemap, and the crawlers (static/robots.txt). */}
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

          <A class='arche' href='/tools/meta-binder'>
            <div class='arche-thumb' aria-hidden='true'>
              <svg viewBox='0 0 100 80'>
                <rect x='16' y='12' width='68' height='56' rx='2' fill='currentColor' opacity='0.14' />
                <rect x='24' y='20' width='22' height='18' fill='currentColor' opacity='0.45' />
                <rect x='54' y='20' width='22' height='18' fill='currentColor' opacity='0.45' />
                <rect x='24' y='44' width='22' height='18' fill='currentColor' opacity='0.28' />
                <rect x='54' y='44' width='22' height='18' fill='currentColor' opacity='0.28' />
                <rect x='48' y='10' width='4' height='60' fill='currentColor' opacity='0.4' />
              </svg>
            </div>
            <div class='arche-name'>Meta Binder</div>
            <div class='arche-stats'>
              <span class='arche-wr'>Work out which cards you need to own to build the decks people are playing</span>
            </div>
          </A>

          <A class='arche' href='/tools/card-wall'>
            <div class='arche-thumb' aria-hidden='true'>
              <svg viewBox='0 0 100 80'>
                <rect x='4' y='14' width='14' height='19' rx='2' fill='currentColor' opacity='0.42' />
                <rect x='22' y='14' width='14' height='19' rx='2' fill='currentColor' opacity='0.42' />
                <rect x='40' y='14' width='14' height='19' rx='2' fill='currentColor' opacity='0.42' />
                <rect x='58' y='14' width='14' height='19' rx='2' fill='currentColor' opacity='0.28' />
                <rect x='76' y='14' width='14' height='19' rx='2' fill='currentColor' opacity='0.14' />
                <rect x='10' y='40' width='14' height='19' rx='2' fill='currentColor' opacity='0.14' />
                <rect x='28' y='40' width='14' height='19' rx='2' fill='currentColor' opacity='0.28' />
                <rect x='46' y='40' width='14' height='19' rx='2' fill='currentColor' opacity='0.42' />
                <rect x='64' y='40' width='14' height='19' rx='2' fill='currentColor' opacity='0.42' />
                <rect x='82' y='40' width='14' height='19' rx='2' fill='currentColor' opacity='0.42' />
              </svg>
            </div>
            <div class='arche-name'>Card Wall</div>
            <div class='arche-stats'>
              <span class='arche-wr'>
                Scroll the cards defining the format past each other, and save the loop as a GIF or a video
              </span>
            </div>
          </A>

          <A class='arche' href='/tools/earnings'>
            <div class='arche-thumb' aria-hidden='true'>
              <svg viewBox='0 0 100 80'>
                <rect x='14' y='20' width='72' height='7' fill='currentColor' opacity='0.5' />
                <rect x='14' y='32' width='56' height='7' fill='currentColor' opacity='0.42' />
                <rect x='14' y='44' width='38' height='7' fill='currentColor' opacity='0.28' />
                <rect x='14' y='56' width='24' height='7' fill='currentColor' opacity='0.16' />
              </svg>
            </div>
            <div class='arche-name'>Earnings</div>
            <div class='arche-stats'>
              <span class='arche-wr'>Rank players by prize money, across a career or inside a single season</span>
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
