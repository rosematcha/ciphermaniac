import { For, onMount } from 'solid-js';
import '../styles/pages/bot.css';

/** The bot's OAuth invite: View Channel, Send Messages and Embed Links, plus slash commands. */
const INVITE_URL =
  'https://discord.com/oauth2/authorize?client_id=1553452093715652768&scope=bot+applications.commands&permissions=19456';

interface PreviewRow {
  name: string;
  record: string;
  table: number;
  opponent: string;
  deck?: string;
}

/** An illustrative round, laid out the way the bot posts one: a header, then an embed per followed player. */
const PREVIEW: PreviewRow[] = [
  { name: 'Gabriel Smart', record: '5-0-0', table: 1, opponent: 'Alex Schemanske', deck: 'Dragapult Blaziken' },
  { name: 'Brent Tonisson', record: '3-1-1', table: 38, opponent: 'Rune Heiremans', deck: 'Gardevoir' },
  { name: 'Henry Chao', record: '2-3-0', table: 214, opponent: 'Piper Lepine', deck: "N's Zoroark" },
  { name: 'Piper Lepine', record: '2-3-0', table: 214, opponent: 'Henry Chao' }
];

/** A Discord message as Discord draws it, so the preview reads as what lands in the channel. */
function DiscordPreview() {
  return (
    <figure class='bot-discord' aria-label='Example of a round posted by the bot in Discord'>
      <img class='bot-discord-avatar' src='/img/ciphermaniac-bot.jpg' alt='' width='40' height='40' />
      <div class='bot-discord-body'>
        <div class='bot-discord-who'>
          <span class='bot-discord-name'>Ciphermaniac</span>
          <span class='bot-discord-app'>APP</span>
          <span class='bot-discord-time'>Today at 12:04</span>
        </div>
        <div class='bot-discord-head'>
          <strong>Peoria · Round 6</strong> · <span class='bot-discord-link'>live</span>
        </div>
        <For each={PREVIEW}>
          {row => (
            <div class='bot-discord-embed'>
              <div class='bot-discord-title'>
                {row.name} · {row.record}
              </div>
              <div class='bot-discord-desc'>
                Table {row.table} vs {row.opponent}
                {row.deck ? ` (${row.deck})` : ''}
              </div>
            </div>
          )}
        </For>
      </div>
    </figure>
  );
}

export function BotPage() {
  onMount(() => {
    document.title = 'Pairings Discord Bot — Ciphermaniac';
  });

  return (
    <section class='bot-split'>
      <div>
        <div class='hero'>
          <h1>Pairings Discord Bot</h1>
        </div>
        <div class='prose bot-prose'>
          <p>The Ciphermaniac Discord bot lets your server stay on top of your regional performance, in real time.</p>
          <ul>
            <li>Find your table at the start of each round from your Discord server.</li>
            <li>Per-server preferred name overrides.</li>
            <li>Integrated archetype reports from Ciphermaniac's event tracker.</li>
          </ul>
        </div>
        <a class='btn btn-primary bot-add' href={INVITE_URL} target='_blank' rel='noopener'>
          Add to your server
        </a>
      </div>
      <DiscordPreview />
    </section>
  );
}
