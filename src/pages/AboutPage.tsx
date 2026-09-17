import { onMount } from 'solid-js';
import { A } from '@solidjs/router';

export function AboutPage() {
  onMount(() => {
    document.title = 'About — Ciphermaniac';
  });

  return (
    <>
      <section class='hero about-column'>
        <h1>About</h1>
      </section>

      <section class='about-column'>
        <div class='prose'>
          <p>
            Howdy, I’m Reese! I’m the solo dev of Ciphermaniac, a frontend for Pokémon TCG data. Ciphermaniac enables
            in-depth, responsive analysis of online Pokémon events, using daily static compiles of data rather than
            making constant real-time calls in service of speed. Ciphermaniac also provides slicker interfaces for
            viewing trends in the game, player history, and events, as well as a few “for-fun” tools.
          </p>

          <p>
            Our deck and player data is primarily sourced from LimitlessTCG and RK9. Pricing data is sourced from
            TCGPlayer’s market price, via TCGCSV. Metadata about events, especially on the event locator, is sourced
            from Pokedata.ovh’s API. See something wrong? Shoot me a request via{' '}
            <A href='/feedback'>the feedback form</A>, or message me on{' '}
            <a href='https://x.com/ciphermaniac' target='_blank' rel='noopener'>
              Twitter
            </a>{' '}
            or{' '}
            <a href='https://discord.com/users/227943656571666432' target='_blank' rel='noopener'>
              Discord
            </a>
            !
          </p>

          <p>
            Ciphermaniac is completely open source. Check out or contribute to the codebase{' '}
            <a href='https://github.com/rosematcha/ciphermaniac' target='_blank' rel='noopener'>
              on GitHub
            </a>
            , and read our{' '}
            <a href='https://r2.ciphermaniac.com/' target='_blank' rel='noopener'>
              API documentation
            </a>{' '}
            to use our data however you like.
          </p>

          <p>
            I run Ciphermaniac as a personal side project, with absolutely no ads and operating completely out of my
            teacher’s salary. If you’ve found the site to be helpful, I’d love your financial support to help keep this
            site running, either via{' '}
            <a href='https://partner.tcgplayer.com/c/6491809/1780961/21018' target='_blank' rel='noopener sponsored'>
              making card purchases via my TCGPlayer affiliate link
            </a>{' '}
            or{' '}
            <a href='https://ko-fi.com/ciphermaniac' target='_blank' rel='noopener'>
              a direct donation via Ko-Fi
            </a>
            .
          </p>

          <p>Thanks to...</p>
          <ul>
            <li>
              <a href='https://limitlesstcg.com/' target='_blank' rel='noopener'>
                LimitlessTCG
              </a>
              ,{' '}
              <a href='https://play.limitlesstcg.com/' target='_blank' rel='noopener'>
                PlayLimitless
              </a>
              , and{' '}
              <a href='https://x.com/limitless_robin' target='_blank' rel='noopener'>
                Robin
              </a>
              , for providing tournament data, a slick online tournament portal, and fundamentally changing how the game
              is talked about and played.
            </li>
            <li>
              <a href='https://tcgcsv.com/' target='_blank' rel='noopener'>
                TCGCSV
              </a>{' '}
              and CptSpaceToaster, for providing CSV-formatted, publicly-accessible TCGPlayer market prices, especially
              as TCGPlayer locks down their API.
            </li>
            <li>
              <a href='https://trainerhill.com' target='_blank' rel='noopener'>
                TrainerHill
              </a>{' '}
              and Brad, for interface inspiration and extremely helpful support in early development.
            </li>
            <li>
              <a href='https://pokedata.ovh' target='_blank' rel='noopener'>
                Pokédata.ovh
              </a>{' '}
              and Julien, for incredible real-time data work on events past, present, and future.
            </li>
          </ul>

          <p>
            Ciphermaniac is not, and does not claim to be, affiliated with The Pokémon Company, Nintendo, Game Freak,
            Creatures Inc., or RK9.
          </p>
        </div>
      </section>
    </>
  );
}
