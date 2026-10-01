-- Adds player accounts (see config/d1/tournaments.sql) to a database made
-- before them: account roles and the public profile's address, the account a
-- reporter row or a decklist belongs to, the history index, and organizer
-- applications. Holds each POP ID to one account, clearing duplicates first,
-- and makes Reese the first admin. Run once, after 0004; SQLite refuses to add
-- a column twice.

ALTER TABLE users ADD COLUMN role TEXT;
ALTER TABLE users ADD COLUMN role_at INTEGER;
ALTER TABLE users ADD COLUMN role_by TEXT;
ALTER TABLE users ADD COLUMN public_slug TEXT;
ALTER TABLE report_devices ADD COLUMN user_id TEXT;
ALTER TABLE decklists ADD COLUMN account TEXT;

CREATE TABLE IF NOT EXISTS pop_history (
  pop_id TEXT NOT NULL,
  code TEXT NOT NULL,
  PRIMARY KEY (pop_id, code)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL,
  pop_id TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  explanation TEXT NOT NULL DEFAULT '',
  proof_key TEXT,
  proof_type TEXT,
  proof_size INTEGER,
  created_at INTEGER NOT NULL,
  decided_at INTEGER,
  decided_by TEXT,
  note TEXT
);
CREATE INDEX IF NOT EXISTS applications_by_user ON applications (user_id, created_at);
CREATE INDEX IF NOT EXISTS applications_by_status ON applications (status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS applications_one_pending ON applications (user_id) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS users_by_role ON users (role) WHERE role IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_by_public_slug ON users (public_slug) WHERE public_slug IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS report_devices_by_account ON report_devices (user_id, code) WHERE user_id IS NOT NULL;

-- One account per POP ID. An empty one was never a POP ID. On a clash the
-- oldest account keeps it: no time was recorded for when a POP ID was
-- entered, so the account's age stands in. List the clashes before running
-- this (see the runbook), so the accounts that lose theirs are known.
UPDATE users SET pop_id = NULL WHERE pop_id = '';
UPDATE users SET pop_id = NULL
 WHERE pop_id IS NOT NULL AND EXISTS (
   SELECT 1 FROM users AS earlier
    WHERE earlier.pop_id = users.pop_id
      AND (earlier.created_at < users.created_at
           OR (earlier.created_at = users.created_at AND earlier.id < users.id)));
CREATE UNIQUE INDEX IF NOT EXISTS users_by_pop_id ON users (pop_id) WHERE pop_id IS NOT NULL;

-- Reese is the first admin. Another admin is this same UPDATE by hand with
-- their email; no request grants admin rights. No event owner is made an
-- organizer here: Reese is the only account running events today. With no
-- account under this email yet, sign in once and run this UPDATE again.
UPDATE users SET role = 'admin', role_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
 WHERE lower(email) = 'admin@example.com';
