import { mkdir, writeFile } from 'node:fs/promises';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
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

async function readJson(key: string): Promise<unknown> {
  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!result.Body) {
    throw new Error(`Missing R2 object: ${key}`);
  }
  return JSON.parse(await result.Body.transformToString()) as unknown;
}

async function embedCurrentRelease(): Promise<void> {
  const pointer = (await readJson('current.json')) as { releaseId?: unknown; manifest?: unknown };
  if (typeof pointer.releaseId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(pointer.releaseId)) {
    throw new Error('Invalid production release pointer');
  }
  const manifestKey =
    typeof pointer.manifest === 'string'
      ? pointer.manifest.replace(/^\/+/, '')
      : `releases/v1/manifests/${pointer.releaseId}.json`;
  const manifest = await readJson(manifestKey);
  const errors = validateReleaseManifest(manifest);
  if (errors.length) {
    throw new Error(`Invalid production manifest: ${errors.join(', ')}`);
  }
  await mkdir('shared/generated', { recursive: true });
  await writeFile('shared/generated/release.ts', renderModule(manifest));
  console.log(`Embedded production release ${pointer.releaseId}`);
}

await embedCurrentRelease();
