-- config/d1/tournaments.sql as it stood before migration 0005, the schema
-- a live database had when 0005 was written: the migration test applies 0005
-- to it and compares the result with a fresh tournaments.sql.

-- D1 database `ciphermaniac-tournaments` (binding TOURNAMENT_DB): accounts,
-- sessions, and the tournaments organizers run on the site. Applied by hand;
-- rerunning is safe.

-- One row per person. Sign-in is Google or Discord only; `identities` maps
-- each provider account to its user, and two providers that report the same
-- verified email land on the same user.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  avatar TEXT,
  -- What the player tells us about themselves, so decklists and pairings can
  -- be matched to the organizer's player list without typing it every time.
  pop_id TEXT,
  first_name TEXT,
  last_name TEXT,
  birth_date TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS users_by_email ON users (email);

CREATE TABLE IF NOT EXISTS identities (
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL,
  PRIMARY KEY (provider, subject)
) WITHOUT ROWID;
-- The account page lists a user's providers; without this that read scans every account's.
CREATE INDEX IF NOT EXISTS identities_by_user ON identities (user_id);

-- The cookie holds the session token; only its SHA-256 is stored.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS sessions_by_user ON sessions (user_id);

-- A tournament is one JSON document (shared/tournament/types.ts) with a
-- version that every write bumps, so two staff saving at once cannot silently
-- overwrite each other. `pending` holds results entered on the site that a
-- TOM-run event has not taken in yet. `player_keys` maps POP IDs to the
-- public keys the event's page shows instead (shared/tournament/view.ts).
CREATE TABLE IF NOT EXISTS tournaments (
  code TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  state TEXT NOT NULL,
  pending TEXT NOT NULL DEFAULT '[]',
  -- Results players reported from the event's page and staff have not settled.
  reports TEXT NOT NULL DEFAULT '[]',
  settings TEXT NOT NULL DEFAULT '{}',
  player_keys TEXT NOT NULL DEFAULT '{}',
  -- POP ID to the archetype each player is on, set by staff or with a decklist.
  decks TEXT NOT NULL DEFAULT '{}',
  staff_token TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
-- On the owner alone: an index that also held `updated_at` would be rewritten
-- by every save, a second row written each time, and the organizer's list
-- sorts its few rows itself.
CREATE INDEX IF NOT EXISTS tournaments_of_owner ON tournaments (owner_id);

-- Who joined an event's staff through its invite link, and when, so the
-- organizer can see everyone the link let in and remove one of them.
CREATE TABLE IF NOT EXISTS staff (
  code TEXT NOT NULL,
  user_id TEXT NOT NULL,
  joined_at INTEGER,
  PRIMARY KEY (code, user_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS staff_by_user ON staff (user_id);

-- One decklist per player per tournament; resubmitting replaces it. The
-- archetype is the player's own word, kept here until staff apply it: a
-- player cannot set what the public page says someone else is on. Players
-- need no account: `user_id` holds the identity the list was submitted under
-- (`pop:<Player ID>`, or `name:["first","last"]` at an unsanctioned event),
-- and `owner_token` the SHA-256 of the token the submitting device keeps. The
-- token reads the list back and is the only way to replace or withdraw it;
-- staff can clear it (NULL) so the next submission under those details
-- takes the list over.
CREATE TABLE IF NOT EXISTS decklists (
  code TEXT NOT NULL,
  user_id TEXT NOT NULL,
  pop_id TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  birth_date TEXT NOT NULL,
  deck TEXT NOT NULL,
  archetype TEXT,
  submitted_at INTEGER NOT NULL,
  owner_token TEXT,
  PRIMARY KEY (code, user_id)
) WITHOUT ROWID;

-- Which device reports for a player at an event where players report their
-- own results. The first device to say who the player is claims them: it
-- keeps a token whose SHA-256 is `token_hash`, and only that token files a
-- report as them, so nobody can report for both seats of a match by knowing
-- the opponent's Player ID. `device` is the SHA-256 of an ID the browser
-- keeps; two agreeing reports from one device go to staff rather than
-- settling. Staff remove a row to let another device claim the player.
CREATE TABLE IF NOT EXISTS report_devices (
  code TEXT NOT NULL,
  player_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  device TEXT NOT NULL,
  claimed_at INTEGER NOT NULL,
  PRIMARY KEY (code, player_id)
) WITHOUT ROWID;
