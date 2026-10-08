-- D1 database `ciphermaniac-tournaments` (binding TOURNAMENT_DB): accounts,
-- sessions, and the tournaments organizers run on the site. Applied by hand;
-- rerunning is safe.

-- One row per person. Sign-in is Google or Discord only; `identities` maps
-- each provider account to its user, and two providers that report the same
-- verified email land on the same user.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT,
  avatar TEXT,
  -- What the player tells us about themselves, so decklists and pairings can
  -- be matched to the organizer's player list without typing it every time.
  -- `birth_date` is the year alone, written 02/27/YYYY as TOM files do: an
  -- account is made only for someone 18 or older (shared/accounts/age.ts),
  -- checked against a full date that is not kept.
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
  -- The Username (shared/accounts/handle.ts): lowercase, one to an account
  -- counting usernames that differ only in separators as the same, and the
  -- public profile's address, /u/<handle>. Every account has one from its
  -- first sign-in; the column is nullable only because a migration added it.
  handle TEXT,
  -- Whether the account's history is public at /u/<handle>, and the name the
  -- profile shows: 'real' (the player profile's, or the username without
  -- one) or 'handle'.
  public_profile INTEGER NOT NULL DEFAULT 0,
  profile_name TEXT NOT NULL DEFAULT 'real',
  -- When the account passed the age check (functions/lib/auth/signup.ts).
  -- NULL only on an account made before the check existed: it holds no
  -- session (sessionUserQuery reads it as no one) and passes the check at its
  -- next sign-in.
  age_checked_at INTEGER
);
-- Provider writes normalize verified emails before storing or looking them up.
CREATE UNIQUE INDEX IF NOT EXISTS users_by_verified_email ON users (email) WHERE email IS NOT NULL;
-- At most one account holds a POP ID. Partial, like the indexes below: most
-- rows hold NULL, and a NULL costs no index row on write.
CREATE UNIQUE INDEX IF NOT EXISTS users_by_pop_id ON users (pop_id) WHERE pop_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS users_by_role ON users (role) WHERE role IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_by_handle ON users (handle);
-- Queries name this expression as written here, or SQLite won't use the index.
CREATE UNIQUE INDEX IF NOT EXISTS users_by_handle_key ON users (replace(replace(replace(handle, '.', ''), '-', ''), '_', ''));

-- Each change of an account's username, kept a day: an account changes it at
-- most three times in a day, and a username it let go (`old_key`, as
-- handleKey gives it) stays its own for that day, so no one else can take it
-- the moment it changes. `handle` is the username it changed to, and
-- `token` the request's own, so only the request that wrote a record may
-- make the change it records.
CREATE TABLE IF NOT EXISTS handle_changes (
  user_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  old_key TEXT NOT NULL,
  handle TEXT NOT NULL,
  token TEXT NOT NULL,
  PRIMARY KEY (user_id, at)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS handle_changes_by_key ON handle_changes (old_key, at);

-- Migration 0008 preserves the original claims it clears from older accounts.
CREATE TABLE IF NOT EXISTS duplicate_emails_backup (
  user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  cleared_at TEXT NOT NULL
);

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

-- A sign-up waiting on its age check (functions/lib/auth/signup.ts): the
-- provider's answer, under the SHA-256 of the token in its cookie, for
-- fifteen minutes. Taken out once, by the check; an adult's becomes the
-- account and anyone else's is deleted.
CREATE TABLE IF NOT EXISTS pending_signups (
  token_hash TEXT PRIMARY KEY,
  profile TEXT NOT NULL,
  next TEXT NOT NULL,
  expires_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS pending_signups_by_expiry ON pending_signups (expires_at);

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
  updated_at INTEGER NOT NULL,
  -- The store that runs the event (see `stores`); NULL for an event a
  -- Community organizer or an Admin runs under their own name, which is
  -- never sanctioned.
  store_id TEXT,
  -- The day a Community organizer's event is on (YYYY-MM-DD), held one to an
  -- owner by the index below: one event per date. NULL for a store's event
  -- and an Admin's.
  community_day TEXT
);
CREATE INDEX IF NOT EXISTS tournaments_of_store ON tournaments (store_id) WHERE store_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tournaments_one_community_day ON tournaments (owner_id, community_day)
  WHERE community_day IS NOT NULL;
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
  -- The year alone (02/27/YYYY), '' at an unsanctioned event. `deck` is
  -- emptied as the event ends when the player may be under 18; the archetype
  -- stays (functions/lib/tournaments/store.ts).
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

-- Wrong birth years given with a Player ID at a sanctioned event, per event
-- and Player ID, so the year cannot be guessed: past five, the Player ID is
-- refused until `locked_until` (epoch ms), a minute and doubling with each
-- wrong try after, up to an hour. A right year clears the row, and staff
-- clear it when they free a player's device.
CREATE TABLE IF NOT EXISTS identify_failures (
  code TEXT NOT NULL,
  pop_id TEXT NOT NULL,
  failures INTEGER NOT NULL,
  locked_until INTEGER NOT NULL,
  PRIMARY KEY (code, pop_id)
) WITHOUT ROWID;

-- The events each POP ID plays in, at sanctioned events only (an event's
-- player IDs are POP IDs there), whether or not an account holds that POP ID
-- yet: an account that enters it later sees every past event at once. Kept
-- with every change to an event's player list or sanctioned setting.
CREATE TABLE IF NOT EXISTS pop_history (
  pop_id TEXT NOT NULL,
  code TEXT NOT NULL,
  PRIMARY KEY (pop_id, code)
) WITHOUT ROWID;

-- The ended events an account wiped from its History
-- (functions/lib/accounts/wipe.ts): their codes alone, so History leaves
-- them out however the account is found in them. Events it plays later,
-- whenever they were made, still show.
CREATE TABLE IF NOT EXISTS history_hidden (
  user_id TEXT NOT NULL,
  code TEXT NOT NULL,
  PRIMARY KEY (user_id, code)
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
  note TEXT,
  -- What the applicant said of the store they apply for, as JSON
  -- (shared/accounts/stores.ts StoreApplication). Approving makes the store
  -- from it, with the applicant its Manager.
  store TEXT
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

-- A certified Play! Pokémon league location that runs sanctioned events on
-- the site (shared/accounts/stores.ts), one per league ID. 'active' or
-- 'revoked': a revoked store starts no events, and its events run on. Its
-- league nights and their exceptions are JSON (LeagueNight[] and
-- NightException[]), only ever replaced whole by a Manager.
CREATE TABLE IF NOT EXISTS stores (
  id TEXT PRIMARY KEY,
  league_id TEXT NOT NULL,
  status TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  postal TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  lat REAL,
  lon REAL,
  time_zone TEXT NOT NULL,
  website TEXT NOT NULL DEFAULT '',
  discord TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '',
  nights TEXT NOT NULL DEFAULT '[]',
  exceptions TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  status_at INTEGER,
  status_by TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS stores_by_league ON stores (league_id);
-- The active stores the locator's index lists, and the Admin's list by name.
CREATE INDEX IF NOT EXISTS stores_by_status ON stores (status, name);

-- Who belongs to a store: 'owner' (a Manager the store is handed over by),
-- 'manager' (edits the store, its staff and league nights) or 'staff' (runs
-- every event the store runs). A store has one Owner, never removed or
-- demoted, so it always keeps someone who manages it.
CREATE TABLE IF NOT EXISTS store_members (
  store_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (store_id, user_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS store_members_by_user ON store_members (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS store_members_one_owner ON store_members (store_id) WHERE role = 'owner';

-- A link a Manager made to let one person into the store as `role`, under
-- the SHA-256 of its token; used once, and good for a week.
CREATE TABLE IF NOT EXISTS store_invites (
  token_hash TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS store_invites_by_store ON store_invites (store_id);

-- Each event made, kept a day, by who made it ('user:<id>' or
-- 'store:<id>'), so the day's creations count deleted events too
-- (shared/tournament/limits.ts).
CREATE TABLE IF NOT EXISTS event_creations (
  owner TEXT NOT NULL,
  at INTEGER NOT NULL,
  id TEXT NOT NULL,
  PRIMARY KEY (owner, at, id)
) WITHOUT ROWID;

-- Private files awaiting deletion after an account fails its age check.
CREATE TABLE IF NOT EXISTS proof_deletions (
  key TEXT PRIMARY KEY
) WITHOUT ROWID;
