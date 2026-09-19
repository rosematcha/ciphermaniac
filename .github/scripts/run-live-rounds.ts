/**
 * Node runner for the live round poller: one `tickEvent` per event per minute.
 *
 * With `LIVE_OUT_DIR` set it writes to that directory instead of R2, which is
 * how the poller is exercised against a real event without publishing anything.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { LIVE_EVENTS } from '../../shared/live/schedule.ts';
import { isEventLive, type LiveStore, tickEvent } from '../../shared/live/tick.ts';
import type { LiveEvent } from '../../shared/live/types.ts';

const POLL_MS = 60_000;
const FETCH_TIMEOUT_MS = 30_000;
const USER_AGENT = 'Mozilla/5.0 (compatible; Ciphermaniac/1.0; +https://ciphermaniac.com)';

function directoryStore(root: string): LiveStore {
  return {
    async getJson<T>(key: string): Promise<T | null> {
      try {
        return JSON.parse(await readFile(join(root, key), 'utf8')) as T;
      } catch {
        return null;
      }
    },
    async putJson(key: string, value: unknown): Promise<void> {
      await mkdir(dirname(join(root, key)), { recursive: true });
      await writeFile(join(root, key), JSON.stringify(value));
    }
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

async function pollOnce(store: LiveStore): Promise<void> {
  const now = new Date();
  for (const event of LIVE_EVENTS.filter(candidate => isEventLive(candidate, now))) {
    const started = process.cpuUsage();
    try {
      const outcome = await tickEvent(event, { now, store, fetchRound, hash });
      const used = process.cpuUsage(started);
      console.log(
        `${now.toISOString()} ${event.slug} ${outcome} cpu=${((used.user + used.system) / 1000).toFixed(1)}ms`
      );
    } catch (error) {
      console.warn(`${now.toISOString()} ${event.slug} failed: ${String(error)}`);
    }
  }
}

async function main(): Promise<void> {
  const outDir = process.env.LIVE_OUT_DIR;
  if (!outDir) {
    throw new Error('LIVE_OUT_DIR is required; the R2 store is not wired up yet');
  }
  const store = directoryStore(outDir);
  for (;;) {
    await pollOnce(store);
    await sleep(POLL_MS);
  }
}

await main();
