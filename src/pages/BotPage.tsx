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

/** The bot's slash commands, in the order a new server meets them. */
const COMMANDS = [
  {
    name: '/follow',
    does: "Follow a player at every event they play. Names autocomplete from Ciphermaniac's player index."
  },
  { name: '/unfollow', does: 'Stop following a player.' },
  {
    name: '/preferred-name',
    does: "Change the name this server's updates use for a player. Leave the name blank to clear it."
  },
  { name: '/following', does: 'List who this server follows and where updates go.' },
  { name: '/setup', does: 'Change the updates channel or add players.' }
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
      <div class='bot-intro'>
        <div class='hero'>
          <h1>Pairings Discord Bot</h1>
        </div>
        <div class='prose'>
          <p>
            Follow players and the bot posts their pairings to your Discord server each round, usually within seconds of
            them going up on RK9. It shows the table number, the opponent, and the opponent's deck if Ciphermaniac has a
            report for it.
          </p>
          <p>
            When the round ends, the bot edits that message to show each player's result and updated record. It also
            marks who made Day 2 and who made top cut.
          </p>
        </div>
        <a class='btn btn-primary bot-add' href={INVITE_URL} target='_blank' rel='noopener'>
          Add to your server
        </a>
      </div>
      <DiscordPreview />
      <div class='prose bot-more'>
        <h2>Setting it up</h2>
        <p>
          After you add the bot, it posts a Set up button. Anyone with Manage Server can use it to pick a channel for
          updates and paste in a list of players, one per line. Nothing else is needed. When the next event starts,
          updates begin at whatever round is current.
        </p>
        <h2>Commands</h2>
        <dl class='glossary'>
          <For each={COMMANDS}>
            {command => (
              <>
                <dt>{command.name}</dt>
                <dd>{command.does}</dd>
              </>
            )}
          </For>
        </dl>
        <p>Changing channels or follows requires Manage Server. A server can follow up to 100 players.</p>
        <h2>Permissions</h2>
        <p>
          The bot asks for View Channel, Send Messages and Embed Links, and uses them only in the channel you choose.
          Player names in updates never ping anyone.
        </p>
      </div>
    </section>
  );
}
