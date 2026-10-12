/**
 * /terms: the tournament service's terms of service, Reese's words. A change
 * that matters is posted on the site 30 days ahead, as the terms say.
 */

import { A } from '@solidjs/router';
import { onMount } from 'solid-js';
import { TournamentHero } from './Hero';

const CONTACT = 'howdy@ciphermaniac.com';

export function TermsPage() {
  onMount(() => {
    document.title = 'Terms of Service — Ciphermaniac';
  });
  return (
    <div class='tm-page tm-narrow'>
      <TournamentHero title='Terms of Service' meta='Last updated October 12, 2026' />
      <div class='prose tm-legal'>
        <p>
          Ciphermaniac Events is a service for running Pokémon Trading Card Game tournaments. By using it, you agree to
          these terms. Please also read our <A href='/privacy'>Privacy Policy</A>, which explains what information we
          keep and how we use it.
        </p>

        <h2 class='tm-subhead'>Using the service</h2>
        <p>
          You must be 16 or older to create an account, and 18 or older to run events. Please keep your account
          information accurate and your sign-in details private. You are responsible for what is done with your account.
        </p>
        <p>
          Please do not use the service to harass other players, submit false results or decklists, pretend to be
          someone else, or interfere with the site or other people’s use of it. We may suspend or remove accounts and
          events that break these terms.
        </p>

        <h2 class='tm-subhead'>Running events</h2>
        <p>
          If you run an event, you are responsible for it. That includes its results, its players’ information, and how
          it is run. When you upload a player list, you confirm that you have the right to share that information with
          us for running the event. Organizers who run sanctioned events also remain bound by the rules of Play!
          Pokémon.
        </p>

        <h2 class='tm-subhead'>Results and availability</h2>
        <p>
          We work hard to keep the service accurate and available. However, it is provided as it is, without any
          guarantee. The official record of an event is the organizer’s tournament file, not our site. To the extent the
          law allows, we are not responsible for losses that come from using the service, including errors in pairings,
          standings or results.
        </p>
        <p>
          Ciphermaniac is not affiliated with The Pokémon Company, Nintendo, Creatures or Game Freak. Pokémon and the
          names of Pokémon products are trademarks of their owners.
        </p>

        <h2 class='tm-subhead'>Ending your use</h2>
        <p>
          You can stop using the service and delete your account at any time from the <A href='/settings'>My Data</A>{' '}
          page. Event records stay as described in our Privacy Policy. We may end or change the service, and we will
          give notice on the site when we reasonably can.
        </p>

        <h2 class='tm-subhead'>Changes and questions</h2>
        <p>
          If we make a significant change to these terms, we will post a notice on the site at least 30 days before it
          takes effect. If you keep using the service after that, you accept the new terms. These terms are governed by
          the laws of the State of Texas. If you have any questions, please write to us at{' '}
          <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
        </p>
      </div>
    </div>
  );
}
