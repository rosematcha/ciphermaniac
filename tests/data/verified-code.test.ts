import assert from 'node:assert/strict';
import test from 'node:test';
import { assertVerifiedCode } from '../../.github/scripts/require-verified-code';

const sha = 'a'.repeat(40);
const successfulChecks = ['quality-gates', 'lighthouse'].map(name => ({
  name,
  conclusion: 'success',
  // eslint-disable-next-line camelcase -- GitHub's Checks API field name
  head_sha: sha,
  app: { slug: 'github-actions' }
}));

test('deployment accepts the current main commit only after both required checks pass', () => {
  assert.doesNotThrow(() => assertVerifiedCode(sha, sha, successfulChecks));
  assert.throws(() => assertVerifiedCode(sha, 'b'.repeat(40), successfulChecks), /obsolete/);
  assert.throws(() => assertVerifiedCode(sha, sha, successfulChecks.slice(0, 1)), /lighthouse/);
  assert.throws(
    () =>
      assertVerifiedCode(
        sha,
        sha,
        successfulChecks.map(check => ({ ...check, conclusion: 'failure' }))
      ),
    /quality-gates/
  );
});

test('similarly named checks from another app cannot authorize deployment', () => {
  const spoofed = successfulChecks.map(check => ({ ...check, app: { slug: 'third-party' } }));
  assert.throws(() => assertVerifiedCode(sha, sha, spoofed), /quality-gates/);
});
