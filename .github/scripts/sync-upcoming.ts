import { pathToFileURL } from 'node:url';
import { scrapeUpcoming } from '../../shared/api/upcomingFetcher';
import type { UpcomingPayload } from '../../shared/upcomingTypes';
import { boolEnv, r2Config } from './lib/env';
import { createR2Client, putJson } from './lib/r2.mjs';

export async function syncUpcoming(
  publish: (payload: UpcomingPayload) => Promise<void>,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const payload = await scrapeUpcoming(fetchImpl);
  if (payload.parseWarning) {
    throw new Error(payload.parseWarning);
  }
  await publish(payload);
}

export async function main(): Promise<void> {
  const dryRun = boolEnv('DRY_RUN');
  await syncUpcoming(async payload => {
    if (!dryRun) {
      const config = r2Config({ defaultBucket: 'ciphermaniac-reports' });
      const client = createR2Client(config);
      await putJson(client, config.bucket, 'upcoming.json', payload, {
        cacheControl: 'public, max-age=3600, s-maxage=21600'
      });
    }
    console.log(`${dryRun ? 'Previewed' : 'Published'} ${payload.events.length} upcoming tournaments`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
