/**
 * /privacy: the tournament service's privacy policy, Reese's words. A change
 * that matters is posted on the site 30 days ahead, as the policy says, and
 * the version it replaces is listed at the bottom once there is one.
 */

import { A } from '@solidjs/router';
import { onMount } from 'solid-js';
import { TournamentHero } from './Hero';

const CONTACT = 'privacy@ciphermaniac.com';

export function PrivacyPage() {
  onMount(() => {
    document.title = 'Privacy Policy — Ciphermaniac';
  });
  return (
    <div class='tm-page tm-narrow'>
      <TournamentHero title='Privacy Policy' meta='Last updated October 12, 2026' />
      <div class='prose tm-legal'>
        <p>
          Ciphermaniac Events is a service for running Pokémon Trading Card Game tournaments. This policy explains what
          information we keep, why we keep it, and what control you have over it.
        </p>

        <h2 class='tm-subhead'>Information we keep</h2>
        <p>
          When you create an account, we keep your first and last name, your Play! Pokémon ID, your birth year, and the
          email address and profile picture provided by Google or Discord when you sign in. If you sign in with a
          username and password instead, your password is verified by our sign-in provider, Clerk. We never see or store
          your password.
        </p>
        <p>
          When you play in an event, we keep the decklists you submit and the match results you report. When you apply
          to host events for a store, we keep the information in your application, including your name, Play! Pokémon ID
          and your explanation, along with your store’s public details.
        </p>
        <p>
          When an organizer adds you to an event, we receive the player list exported from Pokémon’s tournament
          software. That list includes each player’s name, Play! Pokémon ID and birth year. This means you may appear in
          an event on our site even if you have never created an account.
        </p>
        <p>
          Accounts are available only to people 16 and older. We ask for your full birth date once, when you sign up, to
          confirm your age, and then keep only the year. Younger players may still take part in events run on our site,
          and we keep as little about them as possible. Once an event ends, the decklists of players under 18 are
          reduced to the name of the deck’s archetype. Players under 13 do not submit anything to us directly; event
          staff handle their results and decklists.
        </p>

        <h2 class='tm-subhead'>How your information is used</h2>
        <p>
          We use your information only to run this service. We do not sell it. We do not show advertisements, and we do
          not use tracking cookies, analytics tools, or any other way of following you across the site or the web. We
          use only the cookies needed to sign you in and keep you signed in. We use your IP address briefly to protect
          the site from abuse, and we do not store it with your account.
        </p>
        <p>
          Pairings, standings, results and public profiles can be seen by anyone, as is usual for tournaments. Your
          email address, birth year and Play! Pokémon ID are never shown publicly.
        </p>
        <p>
          Our site is hosted by Cloudflare. Depending on how you choose to sign in, Google, Discord or Clerk confirms
          your identity. Each of these companies handles information under its own privacy policy.
        </p>

        <h2 class='tm-subhead'>Your control over your information</h2>
        <p>
          You can download everything we hold about you at any time, from the <A href='/settings'>My Data</A> page, as a
          readable text file. You may also delete any part of your information, or all of it, at any time.
        </p>
        <p>
          Tournaments are shared records. If you delete your account, the pairings and standings of events you played in
          will remain as they are, but they will no longer be linked to your account.
        </p>

        <h2 class='tm-subhead'>Changes and questions</h2>
        <p>
          If we make a minor change to this policy, we will update the date at the top of the page. If we make a
          significant change, such as collecting new information or using it in a new way, we will post a notice on the
          site at least 30 days before it takes effect. Earlier versions of this policy will be listed at the bottom of
          this page.
        </p>
        <p>
          If you have any questions about this policy or your information, please write to us at{' '}
          <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
        </p>
      </div>
    </div>
  );
}
