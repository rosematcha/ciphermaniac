#!/usr/bin/env node

/**
 * Trends-only runner.
 * Uses the shared runOnlineMetaJob implementation to generate trends (and related reports)
 * without modifying the existing online-meta workflow.
 */

import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import process from 'node:process';
import { runOnlineMetaJob } from '../../functions/lib/onlineMeta.js';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

const R2_ACCOUNT_ID = requireEnv('R2_ACCOUNT_ID');
const R2_ACCESS_KEY_ID = requireEnv('R2_ACCESS_KEY_ID');
const R2_SECRET_ACCESS_KEY = requireEnv('R2_SECRET_ACCESS_KEY');
const R2_BUCKET_NAME = requireEnv('R2_BUCKET_NAME');
const R2_REPORTS_PREFIX = process.env.R2_REPORTS_PREFIX || 'reports';

const s3Client = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY
  }
});

async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

class R2Binding {
  constructor(prefix = '') {
    this.prefix = prefix.replace(/\/+$/, '');
  }

  withPrefix(key) {
    return this.prefix ? `${this.prefix}/${key}` : key;
  }

  async put(key, data, options = {}) {
    const body = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    const contentType = options.httpMetadata?.contentType || 'application/json';
    await s3Client.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: this.withPrefix(key),
        Body: body,
        ContentType: contentType
      })
    );
    return { key };
  }

  async get(key) {
    try {
      const object = await s3Client.send(
        new GetObjectCommand({
          Bucket: R2_BUCKET_NAME,
          Key: this.withPrefix(key)
        })
      );
      const text = await streamToString(object.Body);
      return {
        async text() {
          return text;
        }
      };
    } catch (error) {
      if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw error;
    }
  }
}

async function main() {
  const env = {
    REPORTS: new R2Binding(R2_REPORTS_PREFIX),
    LIMITLESS_API_KEY: requireEnv('LIMITLESS_API_KEY')
  };

  try {
    const result = await runOnlineMetaJob(env, {
      // If future: pass trend-specific options here without altering main job defaults
    });
    console.log('[trends-only] Completed', result);
    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error('[trends-only] Failed', error);
    process.exit(1);
  }
}

main();
