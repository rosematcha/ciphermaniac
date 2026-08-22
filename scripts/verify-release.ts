#!/usr/bin/env tsx
/**
 * Verify a published release against live R2.
 *
 * Reads the channel pointer, fetches the manifest it names, and confirms every
 * reference in it actually resolves. Everything it reads is public, so it needs
 * no credentials and can be run by anyone before promoting.
 *
 * This exists because the migration status is hand-maintained prose that can
 * drift from production — one note claimed a decision was pending for five
 * weeks after it shipped. Structural checks (scripts/check-repo-metadata.ts)
 * cannot catch that; only asking production can.
 *
 * Usage:
 *   npx tsx scripts/verify-release.ts                 # production channel
 *   npx tsx scripts/verify-release.ts shadow          # a specific channel
 *   npx tsx scripts/verify-release.ts production 20   # sample N events (0 = all)
 */

import process from 'node:process';

const R2 = process.env.PUBLIC_R2_BASE_URL ?? 'https://r2.ciphermaniac.com';
const channel = process.argv[2] ?? 'production';
const eventSample = Number(process.argv[3] ?? 8);

interface ChannelPointer {
  channel: string;
  releaseId: string;
  promotedFrom?: string;
}

interface ReleaseManifest {
  releaseId: string;
  publishedAt?: string;
  roots: Record<string, string>;
  served: Record<string, string[]>;
  events: Record<string, string | { root?: string }>;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${R2}${path.startsWith('/') ? path : `/${path}`}`);
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} for ${path}`);
  }
  return (await res.json()) as T;
}

/** HEAD would be ideal, but R2's WAF answers some clients 403 on HEAD. */
async function resolves(url: string): Promise<number> {
  try {
    const res = await fetch(url);
    // Drain so the connection can be reused rather than left half-open.
    await res.arrayBuffer().catch(() => undefined);
    return res.status;
  } catch {
    return 0;
  }
}

function eventRoot(value: string | { root?: string }): string | null {
  return typeof value === 'string' ? value : (value?.root ?? null);
}

const problems: string[] = [];

const pointer = await getJson<ChannelPointer>(`build/v1/channels/${channel}.json`);
console.log(`channel ${channel} -> release ${pointer.releaseId}`);

const manifest = await getJson<ReleaseManifest>(`build/v1/releases/${pointer.releaseId}.json`);
if (manifest.releaseId !== pointer.releaseId) {
  problems.push(`manifest releaseId ${manifest.releaseId} does not match the pointer ${pointer.releaseId}`);
}

const publishedAt = manifest.publishedAt ? Date.parse(manifest.publishedAt) : Number.NaN;
if (Number.isFinite(publishedAt)) {
  const ageHours = (Date.now() - publishedAt) / 3_600_000;
  console.log(`published ${manifest.publishedAt} (${ageHours.toFixed(1)}h ago)`);
  if (ageHours > 48) {
    problems.push(`release is ${ageHours.toFixed(0)}h old — the scheduled publish may have stopped`);
  }
}

console.log(`\nscopes: ${Object.keys(manifest.roots).join(', ')}`);
let checked = 0;
for (const [scope, entries] of Object.entries(manifest.served)) {
  const root = manifest.roots[scope];
  if (!root) {
    problems.push(`served scope ${scope} has no root`);
    continue;
  }
  console.log(`  ${scope.padEnd(10)} ${String(entries.length).padStart(3)} served`);
  for (const rel of entries) {
    const status = await resolves(`${R2}${encodeURI(`${root}/${rel}`)}`);
    checked += 1;
    if (status !== 200) {
      problems.push(`${scope}: ${status} for ${root}/${rel}`);
    }
  }
}

const events = Object.entries(manifest.events);
const sampled = eventSample > 0 ? events.slice(0, eventSample) : events;
console.log(`\nevents: ${events.length} in manifest, probing ${sampled.length}`);
for (const [folder, value] of sampled) {
  const root = eventRoot(value);
  if (!root) {
    problems.push(`event ${folder} has no root`);
    continue;
  }
  const status = await resolves(`${R2}${encodeURI(`${root}/master.json`)}`);
  checked += 1;
  if (status !== 200) {
    problems.push(`event ${folder}: ${status} for ${root}/master.json`);
  }
}

console.log(`\n${checked} references probed`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) {
    console.error(`  ${p}`);
  }
  process.exit(1);
}
console.log('every reference in the release resolves');
