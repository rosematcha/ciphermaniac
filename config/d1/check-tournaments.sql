-- Read-only preflight. Missing columns, tables or indexes stop deployment.
SELECT age_checked_at, handle, profile_name FROM users WHERE 0;
SELECT token_hash, profile, expires_at FROM pending_signups WHERE 0;
SELECT store_id, community_day FROM tournaments INDEXED BY tournaments_one_community_day
 WHERE community_day IS NOT NULL LIMIT 0;
SELECT id FROM stores INDEXED BY stores_by_league WHERE 0;
SELECT user_id, role FROM store_members WHERE 0;
SELECT token_hash, expires_at FROM store_invites WHERE 0;
SELECT owner, at, id FROM event_creations WHERE 0;
SELECT store FROM applications WHERE 0;
SELECT key FROM proof_deletions WHERE 0;
