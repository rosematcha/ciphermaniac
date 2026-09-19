/**
 * isMissingObject: the Limitless CDN (DigitalOcean Spaces) answers a missing
 * key with 403 AccessDenied, which must not fail the image mirror.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { isMissingObject } from '../../scripts/cdnObject.ts';

const SPACES_DENIED =
  '<?xml version="1.0" encoding="UTF-8"?><Error><Code>AccessDenied</Code><Message></Message><BucketName>limitlesstcg</BucketName></Error>';

test('a 404 is missing', async () => {
  assert.equal(await isMissingObject(new Response('', { status: 404 })), true);
});

test('a Spaces AccessDenied 403 is missing', async () => {
  assert.equal(await isMissingObject(new Response(SPACES_DENIED, { status: 403 })), true);
});

test('any other 403 is not', async () => {
  assert.equal(await isMissingObject(new Response('<html>Just a moment...</html>', { status: 403 })), false);
});

test('a success or server error is not', async () => {
  assert.equal(await isMissingObject(new Response('png', { status: 200 })), false);
  assert.equal(await isMissingObject(new Response('', { status: 503 })), false);
});
