-- Unsanctioned stores (see config/d1/tournaments.sql): a store with no Play!
-- Pokémon league ID yet, which runs unsanctioned events only and stays off
-- the locator until an Admin gives it its league. SQLite cannot drop NOT NULL
-- from a column, so the table is rebuilt; nothing else refers to it by key.
-- Run once, after 0017.

CREATE TABLE stores_rebuilt (
  id TEXT PRIMARY KEY,
  league_id TEXT,
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
INSERT INTO stores_rebuilt (id, league_id, status, name, address, city, region, postal, country, lat, lon,
  time_zone, website, discord, phone, email, details, nights, exceptions, created_at, updated_at, status_at, status_by)
  SELECT id, league_id, status, name, address, city, region, postal, country, lat, lon,
    time_zone, website, discord, phone, email, details, nights, exceptions, created_at, updated_at, status_at, status_by
  FROM stores;
DROP TABLE stores;
ALTER TABLE stores_rebuilt RENAME TO stores;
CREATE UNIQUE INDEX IF NOT EXISTS stores_by_league ON stores (league_id) WHERE league_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS stores_by_status ON stores (status, name);
