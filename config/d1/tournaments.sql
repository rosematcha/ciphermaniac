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
CREATE INDEX IF NOT EXISTS tournaments_by_owner ON tournaments (owner_id, updated_at);

CREATE TABLE IF NOT EXISTS staff (
  code TEXT NOT NULL,
  user_id TEXT NOT NULL,
  PRIMARY KEY (code, user_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS staff_by_user ON staff (user_id);

-- One decklist per player per tournament; resubmitting replaces it. The
-- archetype is the player's own word, kept here until staff apply it: a
-- player cannot set what the public page says someone else is on.
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
  PRIMARY KEY (code, user_id)
) WITHOUT ROWID;
