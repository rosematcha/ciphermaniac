import { randomHandle } from '../../../shared/accounts/handle.js';
import type { D1Like, ProofBucket } from '../types.js';
import type { Profile } from './oauth.js';

const verifiedEmail = (profile: Profile) =>
  profile.emailVerified ? profile.email?.trim().toLowerCase() || null : null;

/** Remove provider responses still waiting for the same rejected identity. */
function pendingRemoval(db: D1Like, profile: Profile) {
  return db
    .prepare(
      "DELETE FROM pending_signups WHERE (json_extract(profile, '$.provider') = ? " +
        "AND json_extract(profile, '$.subject') = ?) OR (json_extract(profile, '$.emailVerified') = 1 " +
        "AND lower(trim(json_extract(profile, '$.email'))) = ?)"
    )
    .bind(profile.provider, profile.subject, verifiedEmail(profile));
}

/** Retry private-file deletions without losing their keys when R2 is unavailable. */
export async function purgeRejectedProofs(db: D1Like, bucket: ProofBucket | undefined): Promise<void> {
  if (!bucket) {
    return;
  }
  const { results } = await db.prepare('SELECT key FROM proof_deletions LIMIT 100').all<{ key: string }>();
  for (const { key } of results) {
    try {
      await bucket.delete(key);
      await db.prepare('DELETE FROM proof_deletions WHERE key = ?').bind(key).run();
    } catch {
      console.error('Rejected account proof deletion will be retried');
    }
  }
}

/**
 * Forget an unchecked legacy account's online submissions while preserving
 * its opaque ownership ID, including any store's last Manager. Every write
 * rechecks age_checked_at: a concurrent adult verification is never erased.
 */
export async function rejectSignup(db: D1Like, profile: Profile, bucket: ProofBucket | undefined): Promise<void> {
  const email = verifiedEmail(profile);
  const user = await db
    .prepare(
      'SELECT id FROM users WHERE age_checked_at IS NULL AND id = COALESCE(' +
        '(SELECT user_id FROM identities WHERE provider = ? AND subject = ?), ' +
        '(SELECT id FROM users WHERE email IS NOT NULL AND email = ?))'
    )
    .bind(profile.provider, profile.subject, email)
    .first<{ id: string }>();
  const statements = user ? legacyRemoval(db, user.id) : [];
  await db.batch([pendingRemoval(db, profile), ...statements]);
  await purgeRejectedProofs(db, bucket);
}

function legacyRemoval(db: D1Like, userId: string) {
  const target = '(SELECT id FROM users WHERE id = ? AND age_checked_at IS NULL)';
  const deletes = ['sessions', 'identities', 'handle_changes', 'duplicate_emails_backup', 'report_devices', 'staff'];
  const waits = db
    .prepare(
      'DELETE FROM pending_signups WHERE EXISTS (SELECT 1 FROM identities i ' +
        `WHERE i.user_id IN ${target} AND i.provider = json_extract(profile, '$.provider') ` +
        "AND i.subject = json_extract(profile, '$.subject'))"
    )
    .bind(userId);
  const queue = db
    .prepare(
      `INSERT OR IGNORE INTO proof_deletions (key) SELECT proof_key FROM applications WHERE user_id IN ${target} ` +
        `AND proof_key IS NOT NULL UNION SELECT key FROM proof_uploads WHERE user_id IN ${target}`
    )
    .bind(userId, userId);
  const applications = ['applications', 'proof_uploads'].map(table =>
    db.prepare(`DELETE FROM ${table} WHERE user_id IN ${target}`).bind(userId)
  );
  const decks = db.prepare(`DELETE FROM decklists WHERE account IN ${target}`).bind(userId);
  const scrub = db
    .prepare(
      'UPDATE users SET email = NULL, avatar = NULL, pop_id = NULL, first_name = NULL, last_name = NULL, ' +
        "birth_date = NULL, handle = ?, public_profile = 0, profile_name = 'handle', role = 'revoked', " +
        'role_at = NULL, role_by = NULL WHERE id = ? AND age_checked_at IS NULL'
    )
    .bind(randomHandle(), userId);
  return [
    waits,
    queue,
    ...applications,
    decks,
    ...deletes.map(table => db.prepare(`DELETE FROM ${table} WHERE user_id IN ${target}`).bind(userId)),
    scrub
  ];
}
