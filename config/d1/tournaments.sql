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
  created_at INTEGER NOT NULL,
  -- What the account may do beyond playing: NULL for a player, 'organizer'
  -- (may start events), 'revoked' (was an organizer; keeps the events it owns)
  -- or 'admin'. `role_at` and `role_by` say when and by which admin it last
  -- changed; `role_by` is NULL when a migration set it.
  role TEXT,
  role_at INTEGER,
  role_by TEXT,
  -- NULL keeps the account's history private; set, it is public at /u/<slug>.
  public_slug TEXT
);
CREATE INDEX IF NOT EXISTS users_by_email ON users (email);
-- At most one account holds a POP ID. Partial, like the indexes below: most
-- rows hold NULL, and a NULL costs no index row on write.
CREATE UNIQUE INDEX IF NOT EXISTS users_by_pop_id ON users (pop_id) WHERE pop_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS users_by_role ON users (role) WHERE role IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_by_public_slug ON users (public_slug) WHERE public_slug IS NOT NULL;

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
-- Events not yet ended, for the sweep that ends one left idle (functions/api/tournaments/idle.ts).
-- On the finished flag alone, which only an end or a reopen rewrites.
CREATE INDEX IF NOT EXISTS tournaments_by_finished ON tournaments (coalesce(json_extract(settings, '$.finished'), 0));

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
  -- The account the list belongs to, when a signed-in account that is the
  -- list's player sent it; that account may replace or withdraw it from any
  -- device.
  account TEXT,
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
  -- The account that is this player at this event, when an account made or
  -- took the row: its Claim at an unsanctioned event, or its POP ID at a
  -- sanctioned one. That account reports from any of its devices.
  user_id TEXT,
  PRIMARY KEY (code, player_id)
) WITHOUT ROWID;
-- An account's Claims, for its history; unique, so an account is one player per event.
CREATE UNIQUE INDEX IF NOT EXISTS report_devices_by_account ON report_devices (user_id, code) WHERE user_id IS NOT NULL;

-- The events each POP ID plays in, at sanctioned events only (an event's
-- player IDs are POP IDs there), whether or not an account holds that POP ID
-- yet: an account that enters it later sees every past event at once. Kept
-- with every change to an event's player list or sanctioned setting.
CREATE TABLE IF NOT EXISTS pop_history (
  pop_id TEXT NOT NULL,
  code TEXT NOT NULL,
  PRIMARY KEY (pop_id, code)
) WITHOUT ROWID;

-- Accounts asking to become organizers, and what an admin decided. The POP
-- ID and name are the profile as it stood when the account applied. The
-- proof of certification is a file in a private bucket under `proof_key`,
-- deleted once the application is decided; its type stays as a record that a
-- proof was seen.
CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  -- 'pending', 'approved' or 'rejected'.
  status TEXT NOT NULL,
  pop_id TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  explanation TEXT NOT NULL DEFAULT '',
  proof_key TEXT,
  proof_type TEXT,
  proof_size INTEGER,
  created_at INTEGER NOT NULL,
  decided_at INTEGER,
  -- The deciding admin's account id, and their note to the applicant.
  decided_by TEXT,
  note TEXT
);
CREATE INDEX IF NOT EXISTS applications_by_user ON applications (user_id, created_at);
-- Not partial on 'pending': a lookup against a partial index on a value plans as a scan of it.
CREATE INDEX IF NOT EXISTS applications_by_status ON applications (status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS applications_one_pending ON applications (user_id) WHERE status = 'pending';

-- The proof an account has uploaded and not yet sent with an Application,
-- one at a time. Each upload is a file of its own in the private bucket,
-- under a key never used again; a new upload takes this row's place and its
-- file goes. Sending the Application moves the key onto it.
CREATE TABLE IF NOT EXISTS proof_uploads (
  user_id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  type TEXT NOT NULL,
  size INTEGER NOT NULL
) WITHOUT ROWID;
