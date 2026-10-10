-- Beta tester and Early adopter are one or the other. Every account made so
-- far is before launch, so each tests the beta and none adopted early.
DELETE FROM account_badges WHERE badge = 'early';
INSERT OR IGNORE INTO account_badges (user_id, badge, granted_at)
  SELECT id, 'beta', CAST(strftime('%s', 'now') AS INTEGER) * 1000 FROM users;

-- Counts Early adopters against their limit.
CREATE INDEX IF NOT EXISTS account_badges_badge ON account_badges (badge);
