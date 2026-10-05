-- Only verified provider emails have been stored in users.email. Preserve
-- existing accounts and identities; the oldest account keeps a duplicate
-- email for future automatic linking. Other accounts still sign in by identity.
UPDATE users SET email = NULL WHERE trim(email) = '';
CREATE TABLE IF NOT EXISTS duplicate_emails_backup (
  user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  cleared_at TEXT NOT NULL
);
-- Preserve duplicate claims verbatim before removing them from active lookup.
INSERT INTO duplicate_emails_backup (user_id, email, cleared_at)
 SELECT id, email, datetime('now') FROM users
 WHERE email IS NOT NULL AND EXISTS (
   SELECT 1 FROM users AS earlier
    WHERE lower(trim(earlier.email)) = lower(trim(users.email))
      AND (earlier.created_at < users.created_at
           OR (earlier.created_at = users.created_at AND earlier.id < users.id)));
UPDATE users SET email = NULL
 WHERE email IS NOT NULL AND EXISTS (
   SELECT 1 FROM users AS earlier
    WHERE lower(trim(earlier.email)) = lower(trim(users.email))
      AND (earlier.created_at < users.created_at
           OR (earlier.created_at = users.created_at AND earlier.id < users.id)));
UPDATE users SET email = lower(trim(email)) WHERE email IS NOT NULL;
DROP INDEX IF EXISTS users_by_email;
DROP INDEX IF EXISTS users_by_verified_email;
CREATE UNIQUE INDEX IF NOT EXISTS users_by_verified_email ON users (email) WHERE email IS NOT NULL;
