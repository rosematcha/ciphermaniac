import { PutObjectCommand } from '@aws-sdk/client-s3';
import { r2Config } from '../env.ts';
import { createR2Client, putJson, readJson, withR2Retry } from '../r2.mjs';
import { listR2Keys } from '../r2Inventory.mjs';
import type { ProxyImageStore } from './proxies.ts';
import type { CityLeagueStore } from './types.ts';

/** The City League source's store on R2: JSON reads and writes, plus raw image uploads. */
export function cityLeagueR2Store(): CityLeagueStore & ProxyImageStore {
  const config = r2Config();
  const client = createR2Client(config);
  return {
    read: key => readJson(client, config.bucket, key),
    write: (key, value) => putJson(client, config.bucket, key, value),
    list: prefix => listR2Keys(client, config.bucket, prefix),
    async putObject(key, body, contentType) {
      await withR2Retry(() =>
        client.send(
          new PutObjectCommand({
            Bucket: config.bucket,
            Key: key,
            Body: body,
            ContentType: contentType,
            CacheControl: 'public, max-age=31536000, immutable'
          })
        )
      );
    }
  };
}
