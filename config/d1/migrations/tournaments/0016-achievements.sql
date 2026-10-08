-- Who won each finished event: a player ID per division, written as the event ends.
CREATE TABLE IF NOT EXISTS event_wins (
  code TEXT NOT NULL,
  player_id TEXT NOT NULL,
  PRIMARY KEY (code, player_id)
) WITHOUT ROWID;

-- Badges granted by hand (shared/accounts/achievements.ts).
CREATE TABLE IF NOT EXISTS account_badges (
  user_id TEXT NOT NULL,
  badge TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  granted_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, badge)
) WITHOUT ROWID;

-- Every account there is now tested the beta; the first 200 adopted early.
INSERT OR IGNORE INTO account_badges (user_id, badge, granted_at)
  SELECT id, 'beta', CAST(strftime('%s', 'now') AS INTEGER) * 1000 FROM users;
INSERT OR IGNORE INTO account_badges (user_id, badge, granted_at)
  SELECT id, 'early', CAST(strftime('%s', 'now') AS INTEGER) * 1000 FROM users ORDER BY created_at, id LIMIT 200;
INSERT OR IGNORE INTO account_badges (user_id, badge, granted_at)
  SELECT id, 'creator', CAST(strftime('%s', 'now') AS INTEGER) * 1000 FROM users WHERE id = 'nR5TwUcAaKMoilB6';
