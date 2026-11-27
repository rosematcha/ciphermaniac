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

CREATE TABLE IF NOT EXISTS live_report_outbox (
  slug TEXT NOT NULL,
  seat TEXT NOT NULL,
  revision INTEGER NOT NULL,
  published_revision INTEGER NOT NULL DEFAULT 0,
  last_attempted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (slug, seat)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS live_report_outbox_dirty ON live_report_outbox (slug)
  WHERE revision > published_revision;

-- Formats typed into the tier list's Formats tab, one row per name folded to
-- lowercase. Counts only: nothing about who asked is stored. Not emptied by
-- the weekly reset.
CREATE TABLE IF NOT EXISTS format_requests (
  name_key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  count INTEGER NOT NULL,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
) WITHOUT ROWID;
