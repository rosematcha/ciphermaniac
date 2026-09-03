import { For, onMount } from 'solid-js';
import { A } from '@solidjs/router';
import '../styles/pages/tools.css';

// The tools that get a plain row rather than a tile — fun to poke at, but not
// what anyone comes here to do.
const secondary: { href: string; name: string; desc: string }[] = [
  {
    href: '/tools/meta-binder',
    name: 'Meta Binder',
    desc: 'Work out which cards you need to own to build the decks people are playing'
  },
  {
    href: '/tools/card-wall',
    name: 'Card Wall',
    desc: 'Scroll the cards defining the format past each other, and save the loop as a GIF or a video'
  },
  {
    href: '/tools/earnings',
    name: 'Earnings',
    desc: 'Rank players by prize money, across a career or inside a single season'
  },
  {
    href: '/tools/in-loving-memory',
    name: 'In Loving Memory',
    desc: 'Every Day-2 decklist from rotated archetypes, frozen at the end of their run'
  }
];

export function ToolsPage() {
  onMount(() => {
    document.title = 'Tools — Ciphermaniac';
  });

  return (
    <>
      <section class='hero'>
        <h1>Tools</h1>
      </section>

      <section>
        <div class='gallery-grid tools-featured'>
          {/* Social Graphics (/tools/social-graphics) is deliberately not
              listed. The route still works for anyone with the link, but it's
              an internal export tool, so it stays out of the index, the
              sitemap, and the crawlers (static/robots.txt). */}
          <A class='arche' href='/tools/tier-list'>
            <div class='arche-thumb' aria-hidden='true'>
              <svg viewBox='0 0 100 80'>
                <rect x='8' y='14' width='16' height='16' rx='2' fill='currentColor' opacity='0.5' />
                <rect x='28' y='14' width='13' height='16' rx='2' fill='currentColor' opacity='0.28' />
                <rect x='44' y='14' width='13' height='16' rx='2' fill='currentColor' opacity='0.28' />
                <rect x='8' y='33' width='16' height='16' rx='2' fill='currentColor' opacity='0.38' />
                <rect x='28' y='33' width='13' height='16' rx='2' fill='currentColor' opacity='0.2' />
                <rect x='8' y='52' width='16' height='16' rx='2' fill='currentColor' opacity='0.24' />
                <rect x='28' y='52' width='13' height='16' rx='2' fill='currentColor' opacity='0.14' />
                <rect x='44' y='52' width='13' height='16' rx='2' fill='currentColor' opacity='0.14' />
              </svg>
            </div>
            <div class='arche-name'>Tier List Maker</div>
            <div class='arche-stats'>
              <span class='arche-wr'>
                Rank an event's archetypes, or one card's distinct arts, and save it as an image
              </span>
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
        </div>

        <div class='tools-more'>
          <For each={secondary}>
            {t => (
              <A class='tools-more-item' href={t.href}>
                <span class='tools-more-name'>{t.name}</span>
                <span class='tools-more-desc'>{t.desc}</span>
              </A>
            )}
          </For>
        </div>
      </section>
    </>
  );
}
