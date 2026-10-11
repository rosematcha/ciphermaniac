/**
 * /host for someone signed out: what running an event here is, and the way
 * in for organizers. It stands as its own product, Ciphermaniac Events, with
 * its own head in place of the site's nav. The hero plays a sample event on
 * the real pairing engine (SampleEvent); below it, one band for each thing
 * the site does that TOM can't, then three of what any event needs, each
 * with its picture (HostHomeArt).
 */

import { A } from '@solidjs/router';
import { For, type JSX, onCleanup, onMount } from 'solid-js';
import type { SignInOffer } from '../../lib/tournament/api';
import { DecklistArt, FieldArt, PhoneArt, ProfileArt, ResultsArt, ScreenArt, StreamArt, TdfArt } from './HostHomeArt';
import { SampleEvent } from './SampleEvent';
import { SignIn } from './SignIn';
import '../../styles/pages/tournament-home.css';

interface Point {
  name: string;
  art: () => JSX.Element;
  text: string;
}

const BANDS: Point[] = [
  {
    name: 'Opens any .tdf',
    art: TdfArt,
    text: 'Import your .tdf files from other software. Our system produces identical results to other .tdf-producing software.'
  },
  {
    name: 'Mobile reporting',
    art: PhoneArt,
    text: 'Players can find their table, watch the round clock, and report round results from their phones, all without an account.'
  },
  {
    name: 'Player profiles',
    art: ProfileArt,
    text: 'Anyone with an account gets a public page of every event they’ve played, records and decks included.'
  },
  {
    name: 'Big-screen interface',
    art: ScreenArt,
    text: 'A dynamic second screen interface for your space’s TVs shows pairings, a round timer, and standings.'
  },
  {
    name: 'Stream setup ready',
    art: StreamArt,
    text: 'Add an automatic overlay to your stream setup, showing players, records, and deck archetypes.'
  }
];

const FEATURES: Point[] = [
  {
    name: 'Responsive admin console',
    art: ResultsArt,
    text: 'Manage ties, penalties, static seating, and latecomers from a user-friendly interface.'
  },
  {
    name: 'Decklists ahead of time',
    art: DecklistArt,
    text: 'Players can digitally submit compatible lists ahead of time with automatic legality checks.'
  },
  { name: 'Field breakdown', art: FieldArt, text: 'See your event’s meta share and archetype performance.' }
];

/** Marks an element `is-in` while most of it is on screen, so its picture plays only then. */
function watchInView(el: HTMLElement) {
  const observer = new IntersectionObserver(
    entries => entries.forEach(entry => el.classList.toggle('is-in', entry.isIntersecting)),
    { threshold: 0.35 }
  );
  observer.observe(el);
  onCleanup(() => observer.disconnect());
}

function PointView(props: { point: Point }) {
  return (
    <div class='tm-home-point' ref={watchInView}>
      <div class='tm-art'>{props.point.art()}</div>
      <div>
        <h2>{props.point.name}</h2>
        <p>{props.point.text}</p>
      </div>
    </div>
  );
}

/** The product's own head: its name, and the two ways on. */
function Head() {
  return (
    <header class='tm-home-head'>
      <A href='/host' class='tm-home-name'>
        <img src='/logo.svg' alt='' width='24' height='28' />
        <span>
          Ciphermaniac <small>Events</small>
        </span>
      </A>
      <nav aria-label='Ciphermaniac Events'>
        <A href='/tools/event-locator' class='tm-home-wide'>
          Find an event
        </A>
        {/* The browser's own jump: the router ignores a second click on the same hash. */}
        <a href='#sign-in' rel='external'>
          Sign in
        </a>
      </nav>
    </header>
  );
}

export function HostHome(props: { offer: SignInOffer }) {
  // The site's nav and live banner make way for the product's own head.
  onMount(() => document.body.classList.add('tm-home-mode'));
  onCleanup(() => document.body.classList.remove('tm-home-mode'));
  const signIn = () => <SignIn offer={props.offer} next='/host' />;
  return (
    <div class='tm-home'>
      <Head />
      <section class='tm-home-hero'>
        <div>
          <h1>
            Run your Pokémon
            <br />
            TCG events better
          </h1>
          <p class='tm-home-lede'>
            Organize and run your sanctioned or unsanctioned Pokémon TCG events with a slick, user-friendly interface.
          </p>
          <div class='tm-home-signin' id='sign-in'>
            {signIn()}
          </div>
        </div>
        <SampleEvent />
      </section>
      <div class='tm-home-bands'>
        <For each={BANDS}>{point => <PointView point={point} />}</For>
      </div>
      <div class='tm-home-features'>
        <For each={FEATURES}>{point => <PointView point={point} />}</For>
      </div>
      <div class='tm-home-end'>
        <strong>Ready for your next event?</strong>
        {signIn()}
      </div>
    </div>
  );
}
