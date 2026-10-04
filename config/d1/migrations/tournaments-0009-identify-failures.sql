-- Counts wrong birth years given with a Player ID (see config/d1/tournaments.sql).
-- Rerunning is safe.
CREATE TABLE IF NOT EXISTS identify_failures (
  code TEXT NOT NULL,
  pop_id TEXT NOT NULL,
  failures INTEGER NOT NULL,
  locked_until INTEGER NOT NULL,
  PRIMARY KEY (code, pop_id)
) WITHOUT ROWID;
