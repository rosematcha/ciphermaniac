#!/usr/bin/env node

/**
 * Mirror the gen9 Pokémon sprite icons used by archetype rows into our R2
 * bucket (pokemon-sprites/gen9/{slug}.png), so ArchetypeIcon serves them from
 * r2.ciphermaniac.com instead of hotlinking the Limitless CDN. The component
 * falls back to Limitless for any slug this mirror doesn't have yet, so the
 * script is safe to run incrementally — slugs already in the bucket are skipped.
 *
 * The (Card Metadata) Archetype Icons workflow runs this daily after re-scraping
 * the icon map. To run it by hand:
 *
 *   R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
 *   R2_BUCKET_NAME=ciphermaniac-reports npx tsx scripts/mirror-archetype-sprites.ts
 *
 * Pass --force to re-upload every slug regardless of what's already mirrored.
 */

import { r2Config, requireEnv } from '../.github/scripts/lib/env.ts';
import process from 'node:process';
import { readFile } from 'node:fs/promises';
import { createR2Client, readJson } from '../.github/scripts/lib/r2.mjs';
import { mirrorSprites } from '../.github/scripts/lib/mirrorSprites';

const SOURCE_BASE = 'https://r2.limitlesstcg.net/pokemon/gen9';
/**
 * Slugs that are not Pokémon and so are absent from the gen9 CDN. An archetype
 * named for a card carries that card's icon (Dragapult Hammers, for Crushing
 * Hammer), which we take from Training Court, the run tracker the community's
 * matchup posts come from.
 */
const SOURCE_OVERRIDES: Record<string, string> = {
  'crushing-hammer': 'https://www.trainingcourt.app/assets/sprites/crushing-hammer.png'
};

const s3Client = createR2Client(r2Config());
const bucket = requireEnv('R2_BUCKET_NAME');

/**
 * Every slug the site can render, from the committed icon sources and the
 * custom-archetype picker manifest.
 *
 * The icon map covers Standard, which is the only format whose archetypes the
 * runtime looks up by name. The format snapshot carries its own icons inline
 * and reaches much further back — Expanded and the past formats bring in
 * Pokémon that have never been Standard-legal here. The picker manifest then
 * extends that coverage to the full National Dex and supported forms, so
 * custom-archetype sprites remain export-safe too.
 */
async function collectSlugs(): Promise<Set<string>> {
  const slugs = new Set<string>();
  const icons = await readJson<Record<string, string[]>>(s3Client, bucket, 'assets/archetype-icons.json');
  if (!icons) {
    throw new Error('Archetype icon map is missing from R2');
  }
  for (const list of Object.values(icons)) {
    for (const slug of list) {
      slugs.add(slug);
    }
  }
  const formats = await readJson<{ formats?: { archetypes?: { icons?: string[] }[] }[] }>(
    s3Client,
    bucket,
    'assets/format-archetypes.json'
  );
  if (!formats) {
    throw new Error('Format snapshot is missing from R2');
  }
  for (const format of formats.formats ?? []) {
    for (const archetype of format.archetypes ?? []) {
      for (const slug of archetype.icons ?? []) {
        slugs.add(slug);
      }
    }
  }
  const pickerSprites = JSON.parse(await readFile('shared/pokemon/sprites.json', 'utf-8')) as string[];
  for (const slug of pickerSprites) {
    slugs.add(slug);
  }
  return slugs;
}

async function main() {
  // Sprites are immutable once published, so a slug already in the bucket never
  // needs re-fetching. Pass --force to re-upload everything anyway.
  const force = process.argv.includes('--force');
  const slugs = [...(await collectSlugs())].sort();
  console.log(`Mirroring ${slugs.length} sprites${force ? ' (forced)' : ''}…`);
  const stats = await mirrorSprites(s3Client, {
    bucket,
    slugs,
    force,
    sourceUrl: slug => SOURCE_OVERRIDES[slug] ?? `${SOURCE_BASE}/${slug}.png`
  });
  console.log(
    `Done: ${stats.uploaded} uploaded, ${stats.skipped} already mirrored, ${stats.missing} missing at source, ${stats.removed} removed.`
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
