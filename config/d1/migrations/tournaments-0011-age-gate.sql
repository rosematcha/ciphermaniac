-- Accounts are for adults, and the site keeps a birth year at most (see
-- shared/accounts/age.ts and config/d1/tournaments.sql). Adds the table a
-- new sign-up waits in for its age check and the mark an account gets for
-- passing it, signs out every account (none has passed it yet, so each
-- passes it at its next sign-in), cuts every birth date already kept to its
-- year (written 02/27/YYYY, as TOM files do), and deletes the cards of lists
-- at events already over whose player may be under 18. Run once, after
-- 0010; SQLite refuses to add a column twice.

ALTER TABLE users ADD COLUMN age_checked_at INTEGER;
DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE age_checked_at IS NULL);

CREATE TABLE IF NOT EXISTS pending_signups (
  token_hash TEXT PRIMARY KEY,
  profile TEXT NOT NULL,
  next TEXT NOT NULL,
  expires_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS pending_signups_by_expiry ON pending_signups (expires_at);

UPDATE users
   SET birth_date = CASE WHEN birth_date GLOB '*/*/[0-9][0-9][0-9][0-9]' THEN '02/27/' || substr(birth_date, -4) END
 WHERE birth_date IS NOT NULL;

UPDATE decklists
   SET birth_date = CASE WHEN birth_date GLOB '*/*/[0-9][0-9][0-9][0-9]' THEN '02/27/' || substr(birth_date, -4) ELSE '' END
 WHERE birth_date <> '';

-- Each player's birthDate inside the stored event, set by its place in the
-- roster one player at a time, so nothing hangs on the order rows come in.
UPDATE tournaments
   SET state = (
     WITH RECURSIVE step(i, doc) AS (
       SELECT 0, tournaments.state
       UNION ALL
       SELECT i + 1, json_set(doc, '$.players[' || i || '].birthDate',
                CASE WHEN json_extract(doc, '$.players[' || i || '].birthDate') GLOB '*/*/[0-9][0-9][0-9][0-9]'
                     THEN '02/27/' || substr(json_extract(doc, '$.players[' || i || '].birthDate'), -4) ELSE '' END)
         FROM step WHERE i < json_array_length(tournaments.state, '$.players'))
     SELECT doc FROM step ORDER BY i DESC LIMIT 1)
 WHERE json_array_length(state, '$.players') > 0;

-- Written in 2026: anyone born in 2008 or later may still be 17. Run later,
-- this deletes a year more than it must, never less.
UPDATE decklists SET deck = ''
 WHERE deck <> '' AND CAST(substr(birth_date, -4) AS INTEGER) >= 2008
   AND code IN (SELECT code FROM tournaments WHERE coalesce(json_extract(settings, '$.finished'), 0) = 1);
