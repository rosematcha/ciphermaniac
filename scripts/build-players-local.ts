/**
 * Run the player aggregator locally against the public R2 URLs and write the
 * resulting JSON files into `public/players/...` so the Vite dev server can
 * serve them. Lets us see the new pages without a deploy.
 *
 * Usage: `npx tsx scripts/build-players-local.ts`
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlayerAggregates } from '../functions/lib/onlineMeta/playerAggregator';
import { toSlimIndexEntry } from '../shared/playerTypes';

const R2_BASE = 'https://r2.ciphermaniac.com';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Vite's publicDir is `static/` (see vite.config.ts), so writing here makes
// files available at the dev server root, e.g. `/players/index.json`.
const OUT_BASE = join(ROOT, 'static');

// Minimal R2-binding shim. `get` reads from the public R2 over HTTPS; `put`
// writes to the local public/ tree. Matches just the surface the aggregator
// touches (env.REPORTS.get / env.REPORTS.put), nothing more.
const env = {
  REPORTS: {
    async get(key: string) {
      // Read local writes first so the manifest fast-path can see prior runs.
      // Anything not present locally falls back to public R2.
      if (key.startsWith('players/')) {
        try {
          const body = await readFile(join(OUT_BASE, key), 'utf8');
          return { text: async () => body };
        } catch {
          // fall through to R2
        }
      }
      const url = `${R2_BASE}/${encodeURI(key)}`;
      const res = await fetch(url);
      if (!res.ok) {
        return null;
      }
      const body = await res.text();
      return {
        text: async () => body
      };
    },
    async put(key: string, data: string | Uint8Array | Buffer, _opts?: unknown) {
      const fullPath = join(OUT_BASE, key);
      await mkdir(dirname(fullPath), { recursive: true });
      if (typeof data === 'string') {
        await writeFile(fullPath, data);
      } else {
        await writeFile(fullPath, Buffer.from(data));
      }
    }
  }
};

/**
 * Vite's dev middleware is unbearably slow at serving large static JSON files,
 * so for the local preview we slim `players/index.json` after the aggregator
 * runs. Per-player `profile.json` files are unchanged. In production the index
 * goes out at full size via R2.
 */
const LOCAL_INDEX_TOP_N = 1500;

async function main() {
  const t0 = Date.now();
  console.info('[local-build] Running player aggregator against public R2...');
  const result = await buildPlayerAggregates(env as any, {
    concurrency: 6,
    r2Concurrency: 8
  });

  // Sort by event count desc, then by Day 2s, then by tournament wins. Top
  // players surface in the local index; everyone still has a profile.json on
  // disk so direct URLs like /players/:id keep working.
  const trimmed = [...result.index]
    .sort((a, b) => {
      if (b.eventCount !== a.eventCount) {
        return b.eventCount - a.eventCount;
      }
      if (b.day2s !== a.day2s) {
        return b.day2s - a.day2s;
      }
      return b.tournamentWins - a.tournamentWins;
    })
    .slice(0, LOCAL_INDEX_TOP_N);

  const indexPath = join(OUT_BASE, 'players', 'index.json');
  await writeFile(indexPath, JSON.stringify(trimmed, null, 2));

  // Slim index the SPA actually downloads (see playerAggregator.SLIM_INDEX_KEY).
  // Written compact, mirroring production.
  const slimPath = join(OUT_BASE, 'players', 'index-slim.json');
  await writeFile(slimPath, JSON.stringify(trimmed.map(toSlimIndexEntry)));

  const ms = Date.now() - t0;
  console.info('[local-build] Done', {
    profiles: result.profileCount,
    tournamentsScanned: result.tournamentsScanned,
    tournamentsSkipped: result.tournamentsSkipped,
    fullIndexEntries: result.index.length,
    slimmedIndexEntries: trimmed.length,
    durationMs: ms
  });
  console.info(`[local-build] Wrote to ${OUT_BASE}/players/`);
}

main().catch(err => {
  console.error('[local-build] Failed', err);
  process.exit(1);
});
