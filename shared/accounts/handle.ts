/**
 * An account's Username: its handle, the address of its public profile
 * (/u/<handle>), and one to an account. Lowercase ASCII letters and digits,
 * with periods, dashes and underscores between them, 2 to 32 characters.
 * Two usernames that differ only in their separators are the same one
 * (`handleKey`), so rose.matcha cannot stand beside rosematcha.
 */

export const HANDLE_MIN = 2;
export const HANDLE_MAX = 32;

/** How many times an account may change its username in a day, and how long a username let go stays its own. */
export const RENAMES_PER_DAY = 3;
export const DAY_MS = 24 * 60 * 60 * 1000;

const SEPARATORS = /[._-]/g;

/** Usernames that would read as the site speaking, kept by their key. */
const RESERVED = new Set([
  'admin',
  'administrator',
  'api',
  'ciphermaniac',
  'help',
  'mod',
  'moderator',
  'null',
  'official',
  'owner',
  'root',
  'staff',
  'support',
  'system',
  'team',
  'undefined'
]);

/** The username as stored: trimmed and lowercased. */
export const normalizeHandle = (value: string) => value.trim().toLowerCase();

/** What makes two usernames the same one: the username without its separators. */
export const handleKey = (handle: string) => handle.replace(SEPARATORS, '');

/**
 * What is wrong with `handle` (already normalized), or null when it may be a
 * username. Only local test accounts skip the reserved list, so a dev
 * sign-in as Admin reads as admin.
 */
export function handleProblem(handle: string, { reserved = true } = {}): string | null {
  if (handle.length < HANDLE_MIN || handle.length > HANDLE_MAX) {
    return `Use ${HANDLE_MIN} to ${HANDLE_MAX} characters`;
  }
  if (!/^[a-z0-9._-]+$/.test(handle)) {
    return 'Use letters, numbers, periods, dashes and underscores';
  }
  if (!/^[a-z0-9]/.test(handle) || !/[a-z0-9]$/.test(handle)) {
    return 'Start and end with a letter or number';
  }
  if (/[._-]{2}/.test(handle)) {
    return 'Put a letter or number between separators';
  }
  return reserved && RESERVED.has(handleKey(handle)) ? 'That username is reserved' : null;
}

export const isHandle = (value: string, options?: { reserved: boolean }) => handleProblem(value, options) === null;

/** A username for a new account, until it picks its own: player- and eight random letters and digits. */
export function randomHandle(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `player-${[...bytes].map(byte => alphabet[byte % alphabet.length]).join('')}`;
}

/**
 * The name the site calls an account by: the real name from its player
 * profile, or its username while the profile has none.
 */
export function displayName(account: { firstName: string | null; lastName: string | null; handle: string }): string {
  return [account.firstName, account.lastName].filter(Boolean).join(' ').trim() || account.handle;
}
