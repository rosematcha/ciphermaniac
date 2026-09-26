/**
 * Live round poller: `tickEvent` for every live event every few seconds, each
 * deciding for itself whether a look is due, published to `live/v1/{slug}/` on R2.
 *
 * Runs as a long-lived process rather than a Worker cron: parsing a
 * 3,000-player round costs more CPU than a free-plan Worker invocation allows.
 * Normally a service on an always-on host restarts it whenever it exits; the
 * Live Rounds workflow can run it too, as a fallback. It stops itself after
 * LIVE_RUN_MINUTES (under the six-hour Actions limit by default) and exits at
 * once when no event is live; the next run resumes from the published index.
 *
 * The events come from `live/v1/schedule.json`, which each run rebuilds from
 * RK9's event list when the published copy is more than half a day old.
 *
 * With `LIVE_OUT_DIR` set it writes to that directory instead of R2. With
 * `LIVE_NOTIFY_URL` set it POSTs `{ slug }` there after each publish, so the
 * Discord bot can post a new round the moment it is out rather than on its next
 * look. The notice carries no data: the bot still reads the round from R2.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { parseRk9Events } from '../../shared/live/rk9Events.ts';
import { buildSchedule, isEventLive, isScheduleStale, LIVE_SCHEDULE_KEY } from '../../shared/live/schedule.ts';
import { initialState, LIVE_CACHE_CONTROL, liveKeys, resumeState, tickEvent } from '../../shared/live/tick.ts';
import type { LiveEvent, LiveIndex, LiveSchedule, LiveState } from '../../shared/live/types.ts';
import { intEnv, r2Config } from './lib/env.ts';
import { createR2Client, putJson, readJson } from './lib/r2.mjs';

/** Probes run every ten seconds at the most, so a loop this short keeps them close to on time. */
const LOOP_MS = 5_000;
const NOTIFY_TIMEOUT_MS = 5_000;
const FETCH_TIMEOUT_MS = 30_000;
const RK9_EVENTS_URL = 'https://rk9.gg/events/pokemon';
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
    // A failed read throws: resuming from round 1 would republish stale rounds.
    read: <T>(key: string) => readJson<T>(client, config.bucket, key),
    write: (key, value) => putJson(client, config.bucket, key, value, { cacheControl: LIVE_CACHE_CONTROL })
  };
}

async function fetchRk9(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  if (!response.ok) {
    throw new Error(`RK9 ${response.status} for ${url}`);
  }
  return response.text();
}

function fetchRound(event: LiveEvent, round: number): Promise<string> {
  return fetchRk9(`https://rk9.gg/pairings/${event.rk9Id}?pod=${event.pod}&rnd=${round}`);
}

/** The published schedule, rebuilt first when stale. A failed rebuild keeps the published one. */
async function currentSchedule(publisher: Publisher): Promise<LiveSchedule | null> {
  const published = await publisher.read<LiveSchedule>(LIVE_SCHEDULE_KEY);
  const now = new Date();
  if (!isScheduleStale(published, now)) {
    return published;
  }
  try {
    const rebuilt = buildSchedule(parseRk9Events(await fetchRk9(RK9_EVENTS_URL)), now);
    if (rebuilt) {
      await publisher.write(LIVE_SCHEDULE_KEY, rebuilt);
      console.log(`Schedule rebuilt: ${rebuilt.events.map(event => event.slug).join(', ')}`);
      return rebuilt;
    }
  } catch (error) {
    console.warn(`Schedule rebuild failed: ${String(error)}`);
  }
  return published;
}

function hash(text: string): Promise<string> {
  return Promise.resolve(createHash('sha256').update(text).digest('hex'));
}

async function startingState(event: LiveEvent, publisher: Publisher): Promise<LiveState> {
  const index = await publisher.read<LiveIndex>(liveKeys.index(event));
  return index ? resumeState(index) : initialState();
}

/** Tells the bot a round is out. A failed notice only costs the bot's wait for its next look. */
async function notify(url: string | undefined, slug: string): Promise<void> {
  if (!url) {
    return;
  }
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug }),
      signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS)
    });
    if (!response.ok) {
      console.warn(`notify ${slug}: ${response.status}`);
    }
  } catch (error) {
    console.warn(`notify ${slug} failed: ${String(error)}`);
  }
}

/** Probes that find nothing run every ten seconds; logging them would bury everything else. */
const QUIET_OUTCOMES = new Set(['skipped', 'probed']);

async function pollEvent(event: LiveEvent, states: Map<string, LiveState>, publisher: Publisher): Promise<void> {
  const now = new Date();
  let state = states.get(event.slug);
  try {
    state ??= await startingState(event, publisher);
    const result = await tickEvent(event, state, { now, publish: publisher.write, fetchRound, hash });
    states.set(event.slug, result.state);
    if (!QUIET_OUTCOMES.has(result.outcome)) {
      console.log(`${now.toISOString()} ${event.slug} r${result.state.round} ${result.outcome}`);
    }
    if (result.outcome === 'written') {
      await notify(process.env.LIVE_NOTIFY_URL, event.slug);
    }
  } catch (error) {
    // A failed look still counts as one, so an RK9 outage is retried at the pace, not on every loop.
    if (state) {
      states.set(event.slug, { ...state, checkedAt: now.toISOString(), probedAt: now.toISOString() });
    }
    console.warn(`${now.toISOString()} ${event.slug} failed: ${String(error)}`);
  }
}

async function main(): Promise<void> {
  const outDir = process.env.LIVE_OUT_DIR;
  const publisher = outDir ? directoryPublisher(outDir) : r2Publisher();
  const deadline = Date.now() + intEnv('LIVE_RUN_MINUTES', 330, { min: 1 }) * 60_000;
  const states = new Map<string, LiveState>();
  const schedule = await currentSchedule(publisher);
  while (Date.now() < deadline) {
    const live = (schedule?.events ?? []).filter(event => isEventLive(event, new Date()));
    if (live.length === 0) {
      console.log('No live events.');
      return;
    }
    await Promise.all(live.map(event => pollEvent(event, states, publisher)));
    await sleep(LOOP_MS);
  }
}

await main();
