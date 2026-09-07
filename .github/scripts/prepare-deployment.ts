import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException
} from '@aws-sdk/client-s3';
import { requireEnv } from './lib/env';
import { validateReleaseManifest } from '../../shared/data/build/release';
import { renderModule } from './generate-release-module';

const account = requireEnv('R2_ACCOUNT_ID');
const bucket = requireEnv('R2_BUCKET_NAME');
const client = new S3Client({
  region: 'auto',
  endpoint: `https://${account}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: requireEnv('R2_ACCESS_KEY_ID'), secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY') }
});

async function seedMissingMetadata(name: string): Promise<void> {
  const key = `assets/${name}.json`;
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return;
  } catch (error) {
    if (!(error instanceof S3ServiceException) || error.$metadata.httpStatusCode !== 404) {
      throw error;
    }
  }
  const path = `src/data/${name}.json`;
  const removed = execFileSync('git', ['log', '-1', '--format=%H', '--diff-filter=D', '--', path], {
    encoding: 'utf8'
  }).trim();
  if (!/^[a-f0-9]{40}$/.test(removed)) {
    throw new Error(`Cannot locate the last version of ${path}`);
  }
  const body = execFileSync('git', ['show', `${removed}^:${path}`], { encoding: 'utf8' });
  const value: unknown = JSON.parse(body);
  if (!value || typeof value !== 'object' || Object.keys(value).length === 0) {
    throw new Error(`Empty metadata: ${path}`);
  }
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: 'application/json',
      CacheControl: 'public, max-age=300',
      IfNoneMatch: '*'
    })
  );
  console.log(`Seeded ${key} from its last committed version`);
}

async function readJson(key: string): Promise<unknown> {
  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!result.Body) {
    throw new Error(`Missing R2 object: ${key}`);
  }
  return JSON.parse(await result.Body.transformToString()) as unknown;
}

async function embedCurrentRelease(): Promise<void> {
  const pointer = (await readJson('build/v1/channels/production.json')) as { releaseId?: unknown };
  if (typeof pointer.releaseId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(pointer.releaseId)) {
    throw new Error('Invalid production release pointer');
  }
  const manifest = await readJson(`build/v1/releases/${pointer.releaseId}.json`);
  const errors = validateReleaseManifest(manifest);
  if (errors.length) {
    throw new Error(`Invalid production manifest: ${errors.join(', ')}`);
  }
  await mkdir('src/generated', { recursive: true });
  await writeFile('src/generated/release.ts', renderModule(manifest));
  console.log(`Embedded production release ${pointer.releaseId}`);
}

async function requireTestedDeployments(): Promise<void> {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/ciphermaniac`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${requireEnv('CLOUDFLARE_API_TOKEN')}`, 'Content-Type': 'application/json' },
    // eslint-disable-next-line camelcase -- Cloudflare's Pages API names the field
    body: JSON.stringify({ source: { type: 'github', config: { production_deployments_enabled: false } } })
  });
  if (!response.ok) {
    throw new Error(`Could not disable untested Git deployments: HTTP ${response.status}`);
  }
  console.log('Production deployments now run through the tested Actions job');
}

await seedMissingMetadata('archetype-icons');
await seedMissingMetadata('format-archetypes');
await embedCurrentRelease();
await requireTestedDeployments();
