/**
 * Everything the site keeps on an account, as one Markdown file the account
 * can download from Settings: the account itself, its player profile,
 * username and its changes, sign-ins and sessions, History, decklists, the
 * players it reports as, its Applications, stores, the events it organized
 * or staffed, and the events it hid from its History. The account may ask
 * for only some parts (shared/accounts/myData.ts); each section is one's.
 *
 * Every row is written out field by field rather than picked over, so a
 * column added later shows up here without a change. What is left out is
 * what would be no use to the account or would weaken it: session token
 * hashes, the token on a username change, and the event's staff token.
 */

import type { ExportPart } from '../../../shared/accounts/myData.js';
import type { HistoryEntry } from '../../../shared/accounts/types.js';
import { historyOf } from './history.js';
import type { D1Like } from '../types.js';

type Row = Record<string, unknown>;

interface Section {
  title: string;
  rows: Row[];
  /** The field each row is headed by, when rows are many of a kind. */
  heading?: (row: Row) => string;
}

const LABELS = new Map([
  ['pop_id', 'POP ID'],
  ['id', 'ID'],
  ['league_id', 'League ID'],
  ['player_id', 'Player ID'],
  ['code', 'Event code']
]);

const label = (key: string) => LABELS.get(key) ?? `${key[0]?.toUpperCase() ?? ''}${key.slice(1).replace(/_/gu, ' ')}`;

/** Columns that hold a time as epoch milliseconds. */
const isTime = (key: string, value: unknown) => typeof value === 'number' && /(^|_)at$/u.test(key);

const escapeInline = (text: string) => text.replace(/[\\`*_[\]<>#|]/gu, char => `\\${char}`);

/** A fence longer than any run of backticks in the text, so the text cannot close it. */
function fenced(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/gu) ?? []).map(run => run.length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}\n${text}\n${fence}`;
}

function fieldLine(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return `- ${label(key)}: none`;
  }
  if (isTime(key, value)) {
    return `- ${label(key)}: ${new Date(value as number).toISOString()}`;
  }
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.includes('\n') || key === 'deck'
    ? `- ${label(key)}:\n\n${fenced(text)}\n`
    : `- ${label(key)}: ${escapeInline(text)}`;
}

const fields = (row: Row) => Object.entries(row).map(([key, value]) => fieldLine(key, value));

function sectionText(section: Section): string {
  if (section.rows.length === 0) {
    return `## ${section.title}\n\nNone.`;
  }
  const { heading } = section;
  const body = heading
    ? section.rows.map(row => `### ${escapeInline(heading(row))}\n\n${fields(row).join('\n')}`)
    : section.rows.map(row => fields(row).join('\n'));
  return `## ${section.title}\n\n${body.join('\n\n')}`;
}

const eventName = (row: Row) => (typeof row.event === 'string' && row.event !== '' ? row.event : String(row.code));

const historyRow = (entry: HistoryEntry, origin: string): Row => ({
  event: entry.name,
  code: entry.code,
  date: entry.startDate,
  format: entry.format,
  status: entry.status,
  page: `${origin}/t/${entry.code}`
});

const EVENT = "(SELECT json_extract(t.state, '$.info.name') FROM tournaments t WHERE t.code = x.code) AS event";

interface Queried {
  title: string;
  part: ExportPart;
  sql: string;
  heading?: (row: Row) => string;
}

/** The sections read straight from the database, in the order they print, each by one statement on the account's id. */
const QUERIED: Queried[] = [
  {
    title: 'Account',
    part: 'account',
    sql:
      'SELECT id, email, avatar, role, role_at AS role_changed_at, ' +
      "CASE public_profile WHEN 1 THEN 'yes' ELSE 'no' END AS public_profile, profile_name AS name_on_profile, " +
      'created_at, age_checked_at FROM users WHERE id = ?1'
  },
  {
    title: 'Player profile',
    part: 'profile',
    sql: 'SELECT pop_id, first_name, last_name, birth_date FROM users WHERE id = ?1'
  },
  { title: 'Username', part: 'username', sql: 'SELECT handle AS username FROM users WHERE id = ?1' },
  {
    title: 'Username changes in the last day',
    part: 'username',
    sql: 'SELECT at, handle AS username FROM handle_changes WHERE user_id = ?1 ORDER BY at'
  },
  {
    title: 'Sign-ins',
    part: 'account',
    sql: 'SELECT provider, subject FROM identities WHERE user_id = ?1 ORDER BY provider'
  },
  { title: 'Sessions', part: 'account', sql: 'SELECT expires_at FROM sessions WHERE user_id = ?1 ORDER BY expires_at' },
  {
    title: 'Decklists',
    part: 'events',
    heading: eventName,
    sql:
      `SELECT ${EVENT}, x.code, x.pop_id, x.first_name, x.last_name, x.birth_date, x.archetype, x.submitted_at, ` +
      "x.deck FROM decklists x WHERE x.account = ?1 OR x.user_id = 'pop:' || (SELECT pop_id FROM users WHERE id = ?1) " +
      'ORDER BY x.submitted_at'
  },
  {
    title: 'Players you report as',
    part: 'events',
    heading: eventName,
    sql: `SELECT ${EVENT}, x.code, x.player_id, x.claimed_at FROM report_devices x WHERE x.user_id = ?1 ORDER BY x.claimed_at`
  },
  {
    title: 'Events hidden from your history',
    part: 'events',
    heading: eventName,
    sql: `SELECT ${EVENT}, x.code FROM history_hidden x WHERE x.user_id = ?1 ORDER BY x.code`
  },
  {
    title: 'Organizer applications',
    part: 'account',
    sql:
      'SELECT status, pop_id, first_name, last_name, explanation, proof_type, proof_size, created_at, decided_at, ' +
      'note, store FROM applications WHERE user_id = ?1 ORDER BY created_at'
  },
  {
    title: 'Stores',
    part: 'account',
    sql:
      'SELECT s.name, s.league_id, m.role, m.added_at FROM store_members m JOIN stores s ON s.id = m.store_id ' +
      'WHERE m.user_id = ?1 ORDER BY s.name'
  },
  {
    title: 'Events you organized or staffed',
    part: 'organizer',
    heading: eventName,
    sql:
      "SELECT json_extract(x.state, '$.info.name') AS event, x.code, " +
      "json_extract(x.state, '$.info.startDate') AS start_date, " +
      "CASE WHEN x.code IN (SELECT code FROM staff WHERE user_id = ?1) THEN 'staff' ELSE 'organizer' END AS role, " +
      'x.created_at FROM tournaments x WHERE x.owner_id = ?1 OR x.code IN (SELECT code FROM staff WHERE user_id = ?1) ' +
      "OR json_extract(x.state, '$.info.organizerPopId') = (SELECT pop_id FROM users WHERE id = ?1) ORDER BY x.created_at"
  },
  {
    title: 'Badges granted to you',
    part: 'account',
    sql: 'SELECT badge, count, granted_at FROM account_badges WHERE user_id = ?1 ORDER BY badge'
  }
];

/** The statement that says whether the account is there at all, whatever was asked. */
const EXISTS = 'SELECT id FROM users WHERE id = ?1';

/** Where Event history prints among the queried sections: before the decklists. */
const HISTORY_BEFORE = 'Decklists';

async function historySection(db: D1Like, userId: string, origin: string): Promise<Section | null> {
  const history = await historyOf(db, { id: userId });
  return (
    history && {
      title: 'Event history',
      heading: eventName,
      rows: history.entries.map(entry => historyRow(entry, origin))
    }
  );
}

/** What an export asks for: the parts, the site's origin for event links, and the time it is made. */
interface ExportAsk {
  parts: readonly ExportPart[];
  origin: string;
  now?: number;
}

/** The parts asked for of the account's data as Markdown; null when there is no such account. */
export async function exportMarkdown(
  db: D1Like,
  userId: string,
  { parts, origin, now = Date.now() }: ExportAsk
): Promise<string | null> {
  const asked = QUERIED.filter(section => parts.includes(section.part));
  const [found, ...results] = await db.batch(
    [EXISTS, ...asked.map(section => section.sql)].map(sql => db.prepare(sql).bind(userId))
  );
  const history = parts.includes('events') ? await historySection(db, userId, origin) : null;
  if (!found?.results?.length) {
    return null;
  }
  const sections: Section[] = asked.map(({ title, heading }, index) => ({
    title,
    heading,
    rows: (results[index]?.results ?? []) as Row[]
  }));
  if (history) {
    sections.splice(
      asked.findIndex(section => section.title === HISTORY_BEFORE),
      0,
      history
    );
  }
  const head = `# Your data on Ciphermaniac\n\nExported ${new Date(now).toISOString()}.`;
  return `${[head, ...sections.map(sectionText)].join('\n\n')}\n`;
}
