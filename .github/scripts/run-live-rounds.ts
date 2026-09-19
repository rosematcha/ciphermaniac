/**
 * Live round poller: one `tickEvent` per live event per minute, published to
 * `live/v1/{labsCode}/` on R2.
 *
 * Runs as a long GitHub Actions job rather than a Worker cron: parsing a
 * 3,000-player round costs more CPU than a free-plan Worker invocation allows.
 * The job stops itself short of the six-hour runner limit and the workflow's
 * queued run takes over, picking the round up from the published index. It
 * exits at once when no event is live.
 *
 * With `LIVE_OUT_DIR` set it writes to that directory instead of R2.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { isEventLive, LIVE_EVENTS } from '../../shared/live/schedule.ts';
import { initialState, LIVE_CACHE_CONTROL, liveKeys, resumeState, tickEvent } from '../../shared/live/tick.ts';
import type { LiveEvent, LiveIndex, LiveState } from '../../shared/live/types.ts';
import { intEnv, r2Config } from './lib/env.ts';
import { createR2Client, getJsonResult, putJson } from './lib/r2.mjs';

const POLL_MS = 60_000;
const FETCH_TIMEOUT_MS = 30_000;
const USER_AGENT = 'Mozilla/5.0 (compatible; Ciphermaniac/1.0; +https://ciphermaniac.com)';

interface Publisher {
  read: <T>(key: string) => Promise<T | null>;
  write: (key: string, value: unknown) => Promise<void>;
}

function directoryPublisher(root: string): Publisher {
  return {
    async read<T>(key: string): Promise<T | null> {
      try {
        return JSON.parse(await readFile(join(root, key), 'utf8')) as T;
      } catch {
        return null;
      }
    },
    async write(key: string, value: unknown): Promise<void> {
      await mkdir(dirname(join(root, key)), { recursive: true });
      await writeFile(join(root, key), JSON.stringify(value));
    }
  };
}

function r2Publisher(): Publisher {
  const config = r2Config({ defaultBucket: 'ciphermaniac-reports' });
  const client = createR2Client(config);
  return {
    async read<T>(key: string): Promise<T | null> {
      const result = await getJsonResult<T>(client, config.bucket, key);
      if (result.status === 'found') {
        return result.value;
      }
      if (result.status === 'missing') {
        return null;
      }
      // Resuming from round 1 on a failed read would republish stale rounds.
      throw new Error(`Could not read ${key} (${result.status})`, { cause: result.error });
    },
    write: (key, value) => putJson(client, config.bucket, key, value, { cacheControl: LIVE_CACHE_CONTROL })
  };
}

async function fetchRound(event: LiveEvent, round: number): Promise<string> {
  const url = `https://rk9.gg/pairings/${event.rk9Id}?pod=${event.pod}&rnd=${round}`;
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  if (!response.ok) {
    throw new Error(`RK9 ${response.status} for ${url}`);
  }
  return response.text();
}

function hash(text: string): Promise<string> {
  return Promise.resolve(createHash('sha256').update(text).digest('hex'));
}

async function startingState(event: LiveEvent, publisher: Publisher): Promise<LiveState> {
  const index = await publisher.read<LiveIndex>(liveKeys.index(event));
  return index ? resumeState(index) : initialState();
}

async function pollEvent(event: LiveEvent, states: Map<string, LiveState>, publisher: Publisher): Promise<void> {
  const now = new Date();
  try {
    const state = states.get(event.labsCode) ?? (await startingState(event, publisher));
    const result = await tickEvent(event, state, { now, publish: publisher.write, fetchRound, hash });
    states.set(event.labsCode, result.state);
    if (result.outcome !== 'skipped') {
      console.log(`${now.toISOString()} ${event.labsCode} r${result.state.round} ${result.outcome}`);
    }
  } catch (error) {
    console.warn(`${now.toISOString()} ${event.labsCode} failed: ${String(error)}`);
  }
}

async function main(): Promise<void> {
  const outDir = process.env.LIVE_OUT_DIR;
  const publisher = outDir ? directoryPublisher(outDir) : r2Publisher();
  const deadline = Date.now() + intEnv('LIVE_RUN_MINUTES', 330, { min: 1 }) * 60_000;
  const states = new Map<string, LiveState>();
  while (Date.now() < deadline) {
    const live = LIVE_EVENTS.filter(event => isEventLive(event, new Date()));
    if (live.length === 0) {
      console.log('No live events.');
      return;
    }
    await Promise.all(live.map(event => pollEvent(event, states, publisher)));
    await sleep(POLL_MS);
  }
}

await main();
