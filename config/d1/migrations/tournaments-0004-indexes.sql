-- Brings the indexes of a database made before them in line with
-- config/d1/tournaments.sql: providers are found by user without a scan, and
-- the organizer index no longer holds `updated_at`, which every save rewrote.
-- Rerunning is safe.
CREATE INDEX IF NOT EXISTS identities_by_user ON identities (user_id);
DROP INDEX IF EXISTS tournaments_by_owner;
CREATE INDEX IF NOT EXISTS tournaments_of_owner ON tournaments (owner_id);
