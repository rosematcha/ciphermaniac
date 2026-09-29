-- Adds the device claims that let only one device report for each player,
-- and when each staff member joined (see config/d1/tournaments.sql), to a
-- database made before they existed. Run once, after 0002; SQLite refuses to
-- add a column twice.
CREATE TABLE IF NOT EXISTS report_devices (
  code TEXT NOT NULL,
  player_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  device TEXT NOT NULL,
  claimed_at INTEGER NOT NULL,
  PRIMARY KEY (code, player_id)
) WITHOUT ROWID;
ALTER TABLE staff ADD COLUMN joined_at INTEGER;
