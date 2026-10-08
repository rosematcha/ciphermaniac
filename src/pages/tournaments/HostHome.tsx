/**
 * /host for someone signed out: what running an event here is, and the way
 * in for organizers. The hero's picture is a top cut played out from the
 * site's own data (see lib/tournament/metaBracket.ts): the current meta's
 * top eight decks seeded by share, each match going to the deck its online
 * matchup record favours, the champion shown by its signature card. The
 * sections' pictures are built from the interface's own parts, with grey bars
 * for names: the page never shows a made-up player.
 */

import { createResource, For, type JSX, Show } from 'solid-js';
import { CardImage } from '../../components/CardImage';
import { fetchArchetypeMatchupsOnline, type OnlineMatchupRecord } from '../../lib/data/matchups';
import {
  fetchOnlineArchetypes,
  getArchetypeIconMap,
  loadArchetypeIconMap,
  normalizeArchetypeKey,
  resolveArchetypeIcons
} from '../../lib/data/archetypes';
import { ONLINE } from '../../lib/data/paths';
import { fetchMajorsTrendReport } from '../../lib/data/trends';
import { type MetaBracket, playOutBracket } from '../../lib/tournament/metaBracket';
import type { SignInOffer } from '../../lib/tournament/api';
import { DeckIcons } from './DeckIcons';
import { SignIn } from './SignIn';
import '../../styles/pages/tournament-home.css';

/** The majors window the bracket seeds from: the last three events, as the Trends page's default. */
const MAJORS_WINDOW = '3-events';

interface BracketData {
  bracket: MetaBracket;
  /** The champion's signature card, as SET/NNN. */
  art: string | null;
}

/**
 * The top eight archetypes the majors are playing that have a Pokémon to
 * draw, their online matchup records, and the bracket they play out to.
 */
async function loadBracket(): Promise<BracketData | null> {
  const [trends, index] = await Promise.all([
    fetchMajorsTrendReport(),
    fetchOnlineArchetypes(),
    loadArchetypeIconMap()
  ]);
  const series = trends?.windows[MAJORS_WINDOW]?.series ?? [];
  const byKey = new Map(index.map(entry => [normalizeArchetypeKey(entry.label), entry]));
  const top = [...series]
    .sort((a, b) => b.avg - a.avg)
    .map(s => byKey.get(normalizeArchetypeKey(s.label)))
    .filter((entry): entry is NonNullable<typeof entry> =>
      Boolean(entry && resolveArchetypeIcons(entry, getArchetypeIconMap()).length)
    )
    .slice(0, 8);
  if (top.length < 8) {
    return null;
  }
  const records = await Promise.all(top.map(entry => fetchArchetypeMatchupsOnline(ONLINE, entry.name)));
  const matchups = new Map<string, Record<string, OnlineMatchupRecord> | null>(
    top.map((entry, i) => [entry.label, records[i] ?? null])
  );
  const bracket = playOutBracket(
    top.map(entry => entry.label),
    (deck, opponent) => matchups.get(deck)?.[opponent]?.winRate ?? null
  );
  if (!bracket) {
    return null;
  }
  const champion = top.find(entry => entry.label === bracket.champion);
  return { bracket, art: champion?.thumbnails[0] ?? null };
}

/** A bar standing in for a name. */
const Bar = (props: { width: string; strong?: boolean }) => (
  <span class='tm-pic-bar' classList={{ 'is-strong': props.strong }} style={{ width: props.width }} />
);

function Slot(props: { deck: string; won: boolean }) {
  return (
    <span class='tm-cut-slot' classList={{ 'is-won': props.won }}>
      <DeckIcons label={props.deck} size={16} />
      <Bar width='62%' strong={props.won} />
    </span>
  );
}

function Pair(props: { pair: [string, string]; winner: string }) {
  return (
    <div class='tm-cut-pair'>
      <Slot deck={props.pair[0]} won={props.pair[0] === props.winner} />
      <Slot deck={props.pair[1]} won={props.pair[1] === props.winner} />
    </div>
  );
}

/** The bracket, quarterfinals to champion, drawn left to right. */
function BracketPicture(props: { data: BracketData }) {
  const b = () => props.data.bracket;
  const winnerOf = (pair: [string, string]) =>
    [...b().semifinals.flat(), ...b().final, b().champion].find(deck => pair.includes(deck)) ?? pair[0];
  const art = () => (props.data.art ?? '').split('/');
  return (
    <div class='tm-cut-picture' aria-hidden='true'>
      <div class='tm-cut-col'>
        <For each={b().quarterfinals}>{pair => <Pair pair={pair} winner={winnerOf(pair)} />}</For>
      </div>
      <div class='tm-cut-col'>
        <For each={b().semifinals}>
          {pair => <Pair pair={pair} winner={b().final.find(d => pair.includes(d)) ?? pair[0]} />}
        </For>
      </div>
      <div class='tm-cut-col'>
        <Pair pair={b().final} winner={b().champion} />
      </div>
      <div class='tm-cut-col tm-cut-champ'>
        <Show when={art()[0] && art()[1]}>
          <CardImage set={art()[0] as string} number={art()[1] as string} size='xs' alt='' />
        </Show>
        <Slot deck={b().champion} won />
      </div>
    </div>
  );
}

/* ---------- The sections' pictures, from the interface's own parts ---------- */

const ROUND_ROWS: { deck: [string, string]; result: 'done' | 'ask' | 'open' }[] = [
  { deck: ['Dragapult Dusknoir', 'Gardevoir'], result: 'done' },
  { deck: ['Raging Bolt Ogerpon', 'Charizard Pidgeot'], result: 'ask' },
  { deck: ['Gholdengo', 'Crustle'], result: 'open' }
];

function ResultCell(props: { result: 'done' | 'ask' | 'open' }) {
  return (
    <span class='tm-pic-result'>
      <Show when={props.result === 'done'}>
        <b>1–0</b>
      </Show>
      <Show when={props.result === 'ask'}>
        <span class='tm-pic-q'>Wins?</span>
        <span class='btn btn-primary tm-pic-btn'>Record</span>
        <span class='btn btn-ghost tm-pic-btn'>Keep</span>
      </Show>
      <Show when={props.result === 'open'}>
        <span class='muted'>Open</span>
      </Show>
    </span>
  );
}

function ConsolePicture() {
  return (
    <div class='tm-box tm-pic tm-pic-console' aria-hidden='true'>
      <div class='tm-box-bar'>
        <span class='tm-pic-chip'>Round 3</span>
        <span class='muted'>8 of 13 in</span>
        <span class='tm-grow' />
        <span class='tm-pic-clock'>
          <b>23:41</b>
          <span>Pause</span>
        </span>
      </div>
      <For each={ROUND_ROWS}>
        {(row, i) => (
          <div class='tm-pic-row' classList={{ 'is-asking': row.result === 'ask' }}>
            <b>{i() + 4}</b>
            <span class='tm-pic-seat'>
              <DeckIcons label={row.deck[0]} size={16} />
              <Bar width='70%' strong={row.result !== 'open'} />
            </span>
            <span class='tm-pic-seat'>
              <DeckIcons label={row.deck[1]} size={16} />
              <Bar width='60%' />
            </span>
            <ResultCell result={row.result} />
          </div>
        )}
      </For>
    </div>
  );
}

function ScreenPicture() {
  return (
    <div class='tm-box tm-pic tm-pic-screen' aria-hidden='true'>
      <div class='tm-pic-screen-head'>
        <b>Round 3</b>
        <span class='tm-pic-screen-clock'>23:41</span>
      </div>
      <For each={[1, 2, 3, 4, 5]}>
        {n => (
          <div class='tm-pic-screen-row'>
            <b>{n}</b>
            <Bar width='80%' />
            <Bar width='80%' />
          </div>
        )}
      </For>
    </div>
  );
}

function PhonePicture() {
  return (
    <div class='tm-pic-phone' aria-hidden='true'>
      <span class='tm-pic-phone-top'>
        <b>Round 3</b>
        <span>23:41</span>
      </span>
      <span class='tm-pic-phone-table'>
        <b>7</b>
        <span>Table</span>
      </span>
      <span class='tm-pic-phone-opp'>
        <DeckIcons label='Gardevoir' size={22} />
        <span class='tm-pic-phone-who'>
          <Bar width='70%' />
          <Bar width='40%' />
        </span>
      </span>
      <span class='tm-pic-phone-acts'>
        <span class='btn btn-primary'>I won</span>
        <span class='btn btn-secondary'>I lost</span>
        <span class='btn btn-secondary'>Tie</span>
      </span>
    </div>
  );
}

function TdfPicture() {
  return (
    <div class='tm-pic-tdf' aria-hidden='true'>
      <span class='tm-pic-file'>
        <svg width='24' height='30' viewBox='0 0 24 30' fill='none' stroke='currentColor' stroke-width='1.2'>
          <path d='M1 1h15l7 7v21H1z' />
          <path d='M16 1v7h7' />
        </svg>
        <b>.tdf</b>
      </span>
      <span class='tm-pic-wire' />
      <span class='tm-box tm-pic-follow'>
        <span class='tm-box-bar'>
          <b>Following</b>
          <span class='tm-grow' />
          <span class='tm-flag'>Desktop</span>
        </span>
        <span class='tm-box-bar'>
          <span class='btn btn-secondary tm-pic-btn'>Write 3 results to .tdf</span>
        </span>
      </span>
    </div>
  );
}

function ListPicture() {
  return (
    <div class='tm-box tm-pic' aria-hidden='true'>
      <div class='tm-box-bar'>
        <DeckIcons label='Dragapult Dusknoir' size={18} />
        <span class='tm-grow' />
        <span class='tm-num'>60 cards</span>
      </div>
      <For each={[4, 3, 2, 4, 1]}>
        {(n, i) => (
          <div class='tm-pic-line'>
            <b>{n}</b>
            <Bar width={['70%', '52%', '64%', '40%', '58%'][i()] as string} />
          </div>
        )}
      </For>
      <div class='tm-box-bar'>
        <span class='tm-pic-ok'>No problems</span>
        <span class='tm-grow' />
        <span class='btn btn-primary tm-pic-btn'>Submit</span>
      </div>
    </div>
  );
}

function Section(props: { title: string; picture: JSX.Element; children: JSX.Element }) {
  return (
    <section class='tm-home-section'>
      <div class='tm-home-picture'>{props.picture}</div>
      <div class='tm-home-copy'>
        <h2>{props.title}</h2>
        {props.children}
      </div>
    </section>
  );
}

export function HostHome(props: { offer: SignInOffer }) {
  const [bracket] = createResource(() => loadBracket().catch(() => null));
  const signIn = () => <SignIn offer={props.offer} next='/host' />;
  return (
    <div class='tm-home'>
      <section class='tm-home-hero' classList={{ 'has-picture': Boolean(bracket()) }}>
        <h1>Run your event here</h1>
        <p class='tm-home-lede'>
          Organize and run your sanctioned or unsanctioned Pokémon TCG events with a slick, user-friendly interface.
        </p>
        <div class='tm-home-signin'>
          <p class='tm-home-for'>For organizers</p>
          {signIn()}
        </div>
        <Show when={bracket()}>{data => <div class='tm-home-bracket'>{<BracketPicture data={data()} />}</div>}</Show>
      </section>
      <Section title='Report round results' picture={<ConsolePicture />}>
        <p>
          Organizers can notate and report table results from a user-friendly interface. Supports ties, penalties,
          static seating, and latecomers.
        </p>
      </Section>
      <Section title='View pairings on a big screen' picture={<ScreenPicture />}>
        <p>
          As pairings go live in your system, a “big-screen” view optionally shows them in real time. Also includes a
          round timer.
        </p>
      </Section>
      <Section title='Mobile reporting' picture={<PhonePicture />}>
        <p>
          Players who wish to do so can view their pairings, see time in the round, and report results from their phone.
          No account necessary.
        </p>
        <p>Don’t want this? You can disable it!</p>
      </Section>
      <Section title='TOM compatible' picture={<TdfPicture />}>
        <p>
          Works either as a substitute for TOM or in tandem with it. Produces 1:1 compatible .tdf files for Play!
          Pokémon league reporting.
        </p>
        <p class='tm-home-note'>Requires a desktop and TOM.</p>
      </Section>
      <Section title='Decklists before the event' picture={<ListPicture />}>
        <p>
          Handle player registration and list submission digitally, before the event starts. Accepts TCG Live
          formatting, and performs automated checks before the list is accepted.
        </p>
      </Section>
      <div class='tm-home-end'>
        <strong>Run your event here</strong>
        {signIn()}
      </div>
    </div>
  );
}
