-- Gives every account a Username (see config/d1/tournaments.sql): the
-- address of its public profile, in place of the random one drawn when the
-- profile was turned on, and the account name it replaces. Reese's account is
-- rosematcha; any other gets a random one until it picks its own. A profile
-- that was public stays public, at its username. Run once, after 0009;
-- SQLite refuses to add a column twice.

DROP INDEX IF EXISTS users_by_public_slug;
ALTER TABLE users ADD COLUMN handle TEXT;
ALTER TABLE users ADD COLUMN public_profile INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN profile_name TEXT NOT NULL DEFAULT 'real';

UPDATE users SET public_profile = 1 WHERE public_slug IS NOT NULL;
UPDATE users SET handle = 'rosematcha' WHERE id = 'nR5TwUcAaKMoilB6';
UPDATE users SET handle = 'player-' || lower(hex(randomblob(4))) WHERE handle IS NULL;

ALTER TABLE users DROP COLUMN public_slug;
ALTER TABLE users DROP COLUMN name;

CREATE UNIQUE INDEX IF NOT EXISTS users_by_handle ON users (handle);
CREATE UNIQUE INDEX IF NOT EXISTS users_by_handle_key ON users (replace(replace(replace(handle, '.', ''), '-', ''), '_', ''));

CREATE TABLE IF NOT EXISTS handle_changes (
  user_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  old_key TEXT NOT NULL,
  handle TEXT NOT NULL,
  token TEXT NOT NULL,
  PRIMARY KEY (user_id, at)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS handle_changes_by_key ON handle_changes (old_key, at);
