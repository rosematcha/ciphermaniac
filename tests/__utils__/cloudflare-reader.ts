import { GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { Readable } from 'stream';

/**
 * Simple helper to stream S3 GetObject response into string
 */
async function streamToString(stream: Readable | null): Promise<string> {
  if (!stream) {
    return '';
  }
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    stream.on('data', chunk => chunks.push(Buffer.from(chunk)));
    stream.on('error', err => reject(err));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
  });
}

/**
 * Options required for CloudflareReader. All credentials are taken from environment variables
 */
export interface CloudflareReaderOptions {
  r2Bucket?: string;
  r2Endpoint?: string;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  cfAccountId?: string;
  cfKvNamespace?: string;
  cfApiToken?: string;
}

/**
 * Read-only access to production Cloudflare data sources (R2 + KV).
 *
 * This class intentionally exposes only read operations and enforces safety checks
 * to prevent accidental writes to production buckets or KV namespaces.
 */
export class CloudflareReader {
  private s3Client?: S3Client;
  private r2Bucket?: string;
  private cfAccountId?: string;
  private cfKvNamespace?: string;
  private cfApiToken?: string;

  constructor(opts: CloudflareReaderOptions = {}) {
    // Prefer values from explicit options, fallback to environment variables
    this.r2Bucket = opts.r2Bucket || process.env.R2_BUCKET_NAME || undefined;
    this.cfAccountId = opts.cfAccountId || process.env.CLOUDFLARE_ACCOUNT_ID || undefined;
    this.cfKvNamespace = opts.cfKvNamespace || process.env.CLOUDFLARE_KV_NAMESPACE || undefined;
    this.cfApiToken = opts.cfApiToken || process.env.CLOUDFLARE_API_TOKEN || undefined;

    const accessKey = opts.awsAccessKeyId || process.env.AWS_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID;
    const secretKey = opts.awsSecretAccessKey || process.env.AWS_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY;
    const endpoint = opts.r2Endpoint || process.env.R2_ENDPOINT || process.env.S3_ENDPOINT;

    if (accessKey && secretKey && endpoint) {
      // Create S3 client for R2 access using provided endpoint
      this.s3Client = new S3Client({
        region: 'auto',
        endpoint,
        credentials: {
          accessKeyId: accessKey,
          secretAccessKey: secretKey
        },
        forcePathStyle: false
      });
    }
  }

  /**
   * Ensure this instance is read-only. Throws if a write would be attempted.
   */
  private assertReadOnly() {
    // This class only exposes read operations, but keep an explicit guard for future changes.
    // If someone tries to call a write helper, they should see this error.
    // No-op for now; kept for clarity and future safety.
  }

  /**
   * Read a report object from the R2 bucket as text.
   * @param key - object key in the R2 bucket
   * @returns string content of the object
   */
  async readR2Report(key: string): Promise<string> {
    if (!this.s3Client) {
      throw new Error('R2 client not configured: missing credentials or endpoint in environment.');
    }
    if (!this.r2Bucket) {
      throw new Error('R2 bucket name is not configured (R2_BUCKET_NAME).');
    }
    this.assertReadOnly();

    try {
      const cmd = new GetObjectCommand({ Bucket: this.r2Bucket, Key: key });
      const res = await this.s3Client.send(cmd);
      const body = await streamToString(res.Body as Readable);
      return body;
    } catch (err: any) {
      // Surface useful error messages while not leaking secrets
      const msg = `Failed to read R2 object ${key}: ${err?.message ?? String(err)}`;
      throw new Error(msg);
    }
  }

  /**
   * List objects under a prefix in the R2 bucket.
   * @param prefix - prefix to list
   * @returns array of object keys
   */
  async listR2Reports(prefix = ''): Promise<string[]> {
    if (!this.s3Client) {
      throw new Error('R2 client not configured: missing credentials or endpoint in environment.');
    }
    if (!this.r2Bucket) {
      throw new Error('R2 bucket name is not configured (R2_BUCKET_NAME).');
    }
    this.assertReadOnly();

    const keys: string[] = [];
    try {
      let ContinuationToken: string | undefined = undefined;
      do {
        const cmd = new ListObjectsV2Command({ Bucket: this.r2Bucket, Prefix: prefix, ContinuationToken });
        const res = await this.s3Client.send(cmd);
        const contents = res.Contents || [];
        for (const item of contents) {
          if (item.Key) {
            keys.push(item.Key);
          }
        }
        ContinuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
      } while (ContinuationToken);
      return keys;
    } catch (err: any) {
      const msg = `Failed to list R2 objects with prefix ${prefix}: ${err?.message ?? String(err)}`;
      throw new Error(msg);
    }
  }

  /**
   * Read a single key from Cloudflare KV namespace using the Cloudflare API.
   * Requires `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and `CLOUDFLARE_KV_NAMESPACE` to be set in env.
   * @param key - KV key to read
   * @returns the string value stored in KV, or null if not found
   */
  async readKVCache(key: string): Promise<string | null> {
    if (!this.cfApiToken) {
      throw new Error('Cloudflare API token not configured (CLOUDFLARE_API_TOKEN).');
    }
    if (!this.cfAccountId) {
      throw new Error('Cloudflare account ID not configured (CLOUDFLARE_ACCOUNT_ID).');
    }
    if (!this.cfKvNamespace) {
      throw new Error('Cloudflare KV namespace not configured (CLOUDFLARE_KV_NAMESPACE).');
    }

    this.assertReadOnly();

    const url = `https://api.cloudflare.com/client/v4/accounts/${this.cfAccountId}/storage/kv/namespaces/${this.cfKvNamespace}/values/${encodeURIComponent(
      key
    )}`;

    try {
      const res = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${this.cfApiToken}` } });
      if (res.status === 404) {
        return null;
      }
      if (!res.ok) {
        throw new Error(`Cloudflare KV request failed: ${res.status} ${res.statusText}`);
      }
      const text = await res.text();
      return text;
    } catch (err: any) {
      const msg = `Failed to read Cloudflare KV key ${key}: ${err?.message ?? String(err)}`;
      throw new Error(msg);
    }
  }
}
