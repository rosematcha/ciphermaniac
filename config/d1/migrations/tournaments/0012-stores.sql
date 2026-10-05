-- Stores and community organizers (see config/d1/tournaments.sql). A store
-- is a certified Play! Pokémon league location, one per league ID, that runs
-- sanctioned events; accounts join it as manager or staff. The account role
-- 'organizer' becomes 'community': an account that runs unsanctioned events
-- under its own name, with limits. An Application is now for a store. Run
-- once, after 0011; SQLite refuses to add a column twice.

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
CREATE INDEX IF NOT EXISTS stores_by_status ON stores (status, name);

CREATE TABLE IF NOT EXISTS store_members (
  store_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (store_id, user_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS store_members_by_user ON store_members (user_id);

CREATE TABLE IF NOT EXISTS store_invites (
  token_hash TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS store_invites_by_store ON store_invites (store_id);

CREATE TABLE IF NOT EXISTS event_creations (
  owner TEXT NOT NULL,
  at INTEGER NOT NULL,
  id TEXT NOT NULL,
  PRIMARY KEY (owner, at, id)
) WITHOUT ROWID;

ALTER TABLE tournaments ADD COLUMN store_id TEXT;
ALTER TABLE tournaments ADD COLUMN community_day TEXT;
CREATE INDEX IF NOT EXISTS tournaments_of_store ON tournaments (store_id) WHERE store_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tournaments_one_community_day ON tournaments (owner_id, community_day)
  WHERE community_day IS NOT NULL;

ALTER TABLE applications ADD COLUMN store TEXT;

UPDATE users SET role = 'community' WHERE role = 'organizer';
