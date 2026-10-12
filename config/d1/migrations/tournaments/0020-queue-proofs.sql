-- Store Applications no longer carry a proof file. Every file still in the
-- private bucket is queued for deletion (proof_deletions, drained by
-- purgeProofs in functions/lib/auth/rejection.ts), and the rows that named
-- them are emptied. The columns and table themselves stay until a later
-- migration drops them: migrations run before the code that stops reading
-- them is live. Safe to run again.
INSERT OR IGNORE INTO proof_deletions (key)
  SELECT proof_key FROM applications WHERE proof_key IS NOT NULL
  UNION SELECT key FROM proof_uploads;
DELETE FROM proof_uploads;
UPDATE applications SET proof_key = NULL, proof_type = NULL, proof_size = NULL
  WHERE proof_key IS NOT NULL OR proof_type IS NOT NULL OR proof_size IS NOT NULL;
