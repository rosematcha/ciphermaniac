-- Store Owners (see config/d1/tournaments.sql). Each store's earliest Manager,
-- the approved applicant, becomes its one Owner; a unique index keeps it to
-- one. Run once, after 0013.

UPDATE store_members SET role = 'owner'
WHERE role = 'manager' AND user_id = (
  SELECT m.user_id FROM store_members m
  WHERE m.store_id = store_members.store_id AND m.role = 'manager'
  ORDER BY m.added_at, m.user_id LIMIT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS store_members_one_owner ON store_members (store_id) WHERE role = 'owner';
