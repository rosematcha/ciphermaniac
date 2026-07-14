/**
 * Event build CLI.
 *
 * Turns a validated NORMALIZED event record into the full set of serving
 * artifacts (via {@link buildEventArtifacts}) and writes them to a local
 * directory or uploads them to R2 under `reports/{prefix}/`. This is the
 * TypeScript event builder the plan calls for: the Python Labs adapter emits
 * normalized records, and this CLI — the one home for artifact generation —
 * consumes them. Backfill/reprocess scripts call this instead of importing the
 * Python monolith.
 *
 * Usage:
 *   tsx event-cli.ts build --input <normalized.json> --out-dir <dir>
 *   tsx event-cli.ts build --input <normalized.json> --r2-prefix "<date, Name>"
 *
 * R2 mode needs R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY /
 * R2_BUCKET_NAME in the environment.
 * @module .github/scripts/event-cli
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateNormalizedEvent } from '../../shared/data/contracts.ts';
import { buildEventArtifacts } from '../../shared/data/reports/eventArtifacts.ts';
import { type LabsSourceEvent, labsSourceToNormalized } from '../../shared/data/adapters/labsSource.ts';
import type { SynonymDatabase } from '../../shared/data/cardIdentity.ts';
import { createR2Client, putJson } from './lib/r2.mjs';

const CACHE_CONTROL = 'public, max-age=21600';

interface BuildArgs {
  input: string;
  /** 'normalized' (default) or 'labs-source' (run the adapter first). */
  from?: 'normalized' | 'labs-source';
  outDir?: string;
  r2Prefix?: string;
  synonyms?: string;
}

function parseArgs(argv: string[]): BuildArgs {
  const args: Partial<BuildArgs> = { from: 'normalized' };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--input') args.input = value;
    else if (flag === '--out-dir') args.outDir = value;
    else if (flag === '--r2-prefix') args.r2Prefix = value;
    else if (flag === '--synonyms') args.synonyms = value;
    else if (flag === '--from') {
      if (value !== 'normalized' && value !== 'labs-source') throw new Error(`--from must be normalized|labs-source, got "${value}"`);
      args.from = value;
    } else throw new Error(`Unknown flag: ${flag}`);
  }
  if (!args.input) throw new Error('Missing --input <event.json>');
  if (!args.outDir && !args.r2Prefix) throw new Error('Provide --out-dir <dir> or --r2-prefix "<date, Name>"');
  return args as BuildArgs;
}

async function loadJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

/**
 * Validate a normalized event and build its artifacts. Exits non-zero with the
 * collected validation errors when the record is invalid — a malformed record
 * never publishes.
 */
export async function buildFromFile(args: BuildArgs): Promise<Map<string, unknown>> {
  const raw = await loadJson(args.input);
  const synonymDb = args.synonyms ? ((await loadJson(args.synonyms)) as SynonymDatabase) : null;
  // A Labs source record is adapted (all policy applied) before validation.
  const candidate = args.from === 'labs-source' ? labsSourceToNormalized(raw as LabsSourceEvent, { synonymDb }) : raw;
  const result = validateNormalizedEvent(candidate);
  if (!result.ok) {
    throw new Error(`Invalid normalized event (${result.errors.length} errors):\n  ${result.errors.join('\n  ')}`);
  }
  return buildEventArtifacts(result.value, { synonymDb });
}

async function writeLocal(artifacts: Map<string, unknown>, outDir: string): Promise<void> {
  for (const [path, body] of artifacts) {
    const full = join(outDir, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, JSON.stringify(body));
  }
  console.log(`[event-cli] Wrote ${artifacts.size} artifacts to ${outDir}`);
}

async function uploadR2(artifacts: Map<string, unknown>, prefix: string): Promise<void> {
  const accountId = requireEnv('R2_ACCOUNT_ID');
  const bucket = requireEnv('R2_BUCKET_NAME');
  const client = createR2Client({
    accountId,
    accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY')
  });
  const base = `reports/${prefix}`;
  for (const [path, body] of artifacts) {
    await putJson(client, bucket, `${base}/${path}`, body, { cacheControl: CACHE_CONTROL });
  }
  console.log(`[event-cli] Uploaded ${artifacts.size} artifacts to ${bucket}/${base}`);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (command !== 'build') {
    throw new Error(`Unknown command "${command ?? ''}". Supported: build`);
  }
  const args = parseArgs(rest);
  const artifacts = await buildFromFile(args);
  if (args.outDir) await writeLocal(artifacts, args.outDir);
  if (args.r2Prefix) await uploadR2(artifacts, args.r2Prefix);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch(error => {
    console.error('[event-cli]', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
