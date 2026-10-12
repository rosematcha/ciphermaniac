-- Clerk users of deleted accounts, held until Clerk confirms each is gone
-- (functions/lib/auth/clerk.ts). Run once, after 0018.
CREATE TABLE IF NOT EXISTS clerk_deletions (
  subject TEXT PRIMARY KEY
) WITHOUT ROWID;
