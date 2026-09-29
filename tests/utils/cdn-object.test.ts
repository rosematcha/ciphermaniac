/**
 * isMissingObject: the Limitless CDN (DigitalOcean Spaces) answers a missing
 * key with 403 AccessDenied, which must not fail the image mirror.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { isMissingObject } from '../../scripts/cdnObject.ts';

const SPACES_DENIED =
  '<?xml version="1.0" encoding="UTF-8"?><Error><Code>AccessDenied</Code><Message></Message><BucketName>limitlesstcg</BucketName></Error>';

test('a 404 or a Spaces AccessDenied 403 is missing; any other response is not', async () => {
  const cases = [
    ['a 404', new Response('', { status: 404 }), true],
    ['a Spaces AccessDenied 403', new Response(SPACES_DENIED, { status: 403 }), true],
    ['any other 403', new Response('<html>Just a moment...</html>', { status: 403 }), false],
    ['a success', new Response('png', { status: 200 }), false],
    ['a server error', new Response('', { status: 503 }), false]
  ] as const;
  for (const [name, response, missing] of cases) {
    assert.equal(await isMissingObject(response), missing, name);
  }
});
