-- The ended events an account wiped from its History.
CREATE TABLE IF NOT EXISTS history_hidden (
  user_id TEXT NOT NULL,
  code TEXT NOT NULL,
  PRIMARY KEY (user_id, code)
) WITHOUT ROWID;
