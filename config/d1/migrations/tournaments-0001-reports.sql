-- Adds the column for results players report themselves (see
-- config/d1/tournaments.sql) to a database made before it existed. Run once;
-- SQLite refuses to add a column twice.
ALTER TABLE tournaments ADD COLUMN reports TEXT NOT NULL DEFAULT '[]';
