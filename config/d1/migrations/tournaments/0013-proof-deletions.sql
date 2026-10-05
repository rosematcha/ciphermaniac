-- Durable private-file deletion retries for rejected legacy accounts.
-- Apply after 0012 and before deploying the rejection cleanup.
CREATE TABLE IF NOT EXISTS proof_deletions (
  key TEXT PRIMARY KEY
) WITHOUT ROWID;
