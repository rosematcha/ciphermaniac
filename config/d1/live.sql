-- D1 database `ciphermaniac-live` (binding LIVE_DB): one row per device per seat
-- per event, emptied every Tuesday by the Live Reports Reset workflow. Applied
-- by hand; rerunning is safe.
CREATE TABLE IF NOT EXISTS votes (
  slug TEXT NOT NULL,
  seat TEXT NOT NULL,
  voter TEXT NOT NULL,
  archetype TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (slug, seat, voter)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS votes_by_voter ON votes (slug, voter);
