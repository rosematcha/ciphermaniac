CREATE TABLE IF NOT EXISTS live_report_outbox (
  slug TEXT NOT NULL,
  seat TEXT NOT NULL,
  revision INTEGER NOT NULL,
  published_revision INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (slug, seat)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS live_report_outbox_dirty ON live_report_outbox (slug)
  WHERE revision > published_revision;

INSERT INTO live_report_outbox (slug, seat, revision, published_revision)
SELECT DISTINCT slug, seat, 1, 0 FROM votes WHERE true
ON CONFLICT (slug, seat) DO NOTHING;
