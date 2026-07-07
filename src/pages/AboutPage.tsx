import { onMount } from 'solid-js';
import { A } from '@solidjs/router';

export function AboutPage() {
  onMount(() => {
    document.title = 'About — Ciphermaniac';
  });

  return (
    <>
      <section class='hero'>
        <h1>About</h1>
        <div class='hero-meta'>
          <span>A meta-analysis tool for the Pokémon TCG</span>
        </div>
      </section>

      <section>
        <div class='prose'>
          <p>
            Ciphermaniac aggregates Pokémon TCG tournament results to expose what's actually being played, how often,
            and where it's winning. Browse cards, drill into archetypes, and follow the meta as it shifts.
          </p>

          <h2>How it works</h2>
          <p>Tournament data is collected and processed automatically through GitHub Actions:</p>
          <ul>
            <li>
              <strong>Online meta</strong> — the rolling last 14 days of online tournaments from PlayLimitless.
              Refreshed daily.
            </li>
            <li>
              <strong>Tournament reports</strong> — Day 2 decklists from major events on LimitlessTCG, scraped on
              demand.
            </li>
            <li>
              <strong>Pricing</strong> — daily market prices from TCGCSV.
            </li>
          </ul>
          <p>
            All data lands in Cloudflare R2 and is fetched by the browser directly. No per-page server-side rendering on
            the critical path — pages load fast and the meta updates automatically as new data arrives.
          </p>

          <h2>URL structure</h2>
          <p>
            Card URLs follow Limitless TCG's pattern: <code>/cards/SET/NUMBER</code>. Iono from Paldea Evolved is{' '}
            <A href='/cards/PAL/185'>/cards/PAL/185</A>. Archetypes are slugged by their base name, e.g.{' '}
            <A href='/archetypes/Dragapult'>/archetypes/Dragapult</A>.
          </p>

          <h2 id='glossary'>Reading the numbers</h2>
          <p>What each metric on the site means:</p>
          <dl class='glossary'>
            <dt>Inclusion</dt>
            <dd>Share of decks playing at least one copy of this card.</dd>
            <dt>Meta share</dt>
            <dd>This archetype's share of all decks in the report.</dd>
            <dt>Conversion</dt>
            <dd>Share of the Day 1 decks playing this card that advanced to Day 2.</dd>
            <dt>Prevalence</dt>
            <dd>This opponent's share of the field.</dd>
            <dt>Day 2</dt>
            <dd>Players whose Day 1 record kept them in the tournament.</dd>
            <dt>Top cut</dt>
            <dd>The single-elimination bracket that ends the event.</dd>
            <dt>Newcomers</dt>
            <dd>Archetypes appearing in this window for the first time.</dd>
          </dl>
          <p>Two conventions worth knowing:</p>
          <ul>
            <li>
              Matchup win rates count a tie as one third of a win. Player-page win rates exclude ties and say so where
              shown.
            </li>
            <li>pp means percentage points: the difference between two shares.</li>
          </ul>

          <h2>Credits</h2>
          <ul>
            <li>
              <strong>
                <a href='https://limitlesstcg.com' target='_blank' rel='noopener'>
                  LimitlessTCG
                </a>
              </strong>
              ,{' '}
              <strong>
                <a href='https://play.limitlesstcg.com' target='_blank' rel='noopener'>
                  PlayLimitless
                </a>
              </strong>
              , and{' '}
              <strong>
                <a href='https://x.com/limitless_robin' target='_blank' rel='noopener'>
                  Robin
                </a>
              </strong>{' '}
              — tournament data. The Limitless team's work is foundational to the Pokémon TCG community.
            </li>
            <li>
              <strong>
                <a href='https://trainerhill.com' target='_blank' rel='noopener'>
                  TrainerHill
                </a>
              </strong>{' '}
              and <strong>Brad</strong> — deck archetype analysis and early development support.
            </li>
            <li>
              <strong>
                <a href='https://tcgcsv.com' target='_blank' rel='noopener'>
                  TCGCSV
                </a>
              </strong>{' '}
              and <strong>CptSpaceToaster</strong> — for exposing TCGPlayer market prices in a usable form.
            </li>
          </ul>

          <p>Not affiliated with The Pokémon Company, Nintendo, Game Freak, Creatures Inc., or RK9.</p>
        </div>
      </section>
    </>
  );
}
