import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { main, syncUpcoming } from '../../.github/scripts/sync-upcoming';
import type { UpcomingPayload } from '../../shared/upcomingTypes';

async function fixture(name: string): Promise<string> {
  return readFile(new URL(`../fixtures/upcoming/${name}.html`, import.meta.url), 'utf8');
}

test('scheduled builder publishes parsed, sorted events with refresh and source metadata', async () => {
  const published: UpcomingPayload[] = [];
  await syncUpcoming(
    async payload => {
      published.push(payload);
    },
    async (url, init) => {
      assert.equal(url, 'https://limitlesstcg.com/tournaments/upcoming?game=PTCG');
      assert.ok(init?.signal);
      return new Response(await fixture('normal'));
    }
  );
  assert.equal(published.length, 1);
  assert.equal(published[0].events.length, 3);
  assert.match(published[0].refreshedAt, /^20/);
  assert.match(published[0].source, /limitlesstcg/);
  assert.equal(published[0].parseWarning, undefined);
});

test('scheduled builder preserves existing data on upstream and parser failures', async () => {
  let writes = 0;
  const publish = async () => {
    writes += 1;
  };
  for (const html of [await fixture('renamed-attributes'), '<html>rate limited</html>']) {
    await assert.rejects(syncUpcoming(publish, async () => new Response(html)));
  }
  await assert.rejects(
    syncUpcoming(publish, async () => new Response('', { status: 429 })),
    /Upstream 429/
  );
  await assert.rejects(
    syncUpcoming(publish, async () => {
      throw new Error('timeout');
    }),
    /timeout/
  );
  assert.equal(writes, 0);
});

test('scheduled builder permits a legitimately empty schedule and surfaces upload failures', async () => {
  await syncUpcoming(
    async payload => {
      assert.deepEqual(payload.events, []);
    },
    async () => new Response(await fixture('empty'))
  );
  await assert.rejects(
    syncUpcoming(
      async () => {
        throw new Error('R2 unavailable');
      },
      async () => new Response(await fixture('normal'))
    ),
    /R2 unavailable/
  );
});

test('the builder uploads upcoming.json with caching metadata and honors dry runs', async t => {
  const variables = {
    R2_ACCOUNT_ID: 'test-account',
    R2_ACCESS_KEY_ID: 'test-key',
    R2_SECRET_ACCESS_KEY: 'test-secret',
    R2_BUCKET_NAME: 'test-bucket',
    DRY_RUN: 'false'
  };
  const saved = Object.fromEntries(Object.keys(variables).map(key => [key, process.env[key]]));
  Object.assign(process.env, variables);
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
  t.mock.method(console, 'log', () => undefined);
  t.mock.method(globalThis, 'fetch', async () => new Response(await fixture('normal')));
  const send = t.mock.method(S3Client.prototype, 'send', async (command: PutObjectCommand) => {
    assert.ok(command instanceof PutObjectCommand);
    assert.equal(command.input.Bucket, 'test-bucket');
    assert.equal(command.input.Key, 'upcoming.json');
    assert.equal(command.input.ContentType, 'application/json');
    assert.equal(command.input.CacheControl, 'public, max-age=3600, s-maxage=21600');
    const payload = JSON.parse(String(command.input.Body)) as UpcomingPayload;
    assert.equal(payload.events.length, 3);
    return {};
  });
  await main();
  assert.equal(send.mock.calls.length, 1);
  process.env.DRY_RUN = 'true';
  await main();
  assert.equal(send.mock.calls.length, 1);
});
