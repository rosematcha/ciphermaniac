/**
 * Architectural guard: card UIDs are built in exactly one place.
 *
 * D20 was not one bug, it was one bug repeated — `Name::SET::NUMBER` assembled
 * by interpolation at a dozen sites, half of which forgot to normalize the
 * collector number. A type cannot catch that (both spellings are strings), and
 * a reviewer will not catch the thirteenth one. A grep will.
 *
 * If this fails, you added a hand-built card UID. Use `cardUid` /
 * `cardUidOrName` from shared/data/cardIdentity instead.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

const SEARCH_ROOTS = ['src', 'shared', 'functions', 'scripts', '.github/scripts'];
const EXTENSIONS = ['.ts', '.tsx', '.mts', '.mjs', '.js'];

/**
 * Files allowed to assemble the form, with the reason each is legitimate.
 * Adding an entry here should feel like a decision, not a formality.
 */
const ALLOWED = new Map<string, string>([
  ['shared/data/cardIdentity.ts', 'defines cardUid — the one constructor'],
  [
    'shared/data/canonicalPrint.ts',
    'rebuilds a UID from a set-catalog print already normalized by the catalog, for rolling-canonical selection'
  ],
  [
    '.github/scripts/update-card-synonyms.mjs',
    'generates the synonym database itself, from scraped print records that carry the canonical spelling'
  ]
]);

/**
 * The three-part `Name::SET::NUMBER` card-UID shape, built by interpolation.
 *
 * Scoped to THREE interpolated segments on purpose. The two-part `SET::NUMBER`
 * form is a different key (zero-STRIPPED, used for snapshot/card-type/sitemap
 * indexes) with its own constructors — `cardNumberIndexKey` and `cardRouteKey`.
 * Lumping them together made this guard fire on legitimate index-key builders
 * and on deck fingerprint strings, which is how a guard earns a blanket ignore.
 */
const UID_TEMPLATE = /`[^`]*\$\{[^}]*\}::\$\{[^}]*\}::\$\{/;

/** `::`-joined strings that are not card identity at all. */
const NON_CARD_KEY = /tournament|archetypeBase|dateIso|placing|player|file|entry\.|\bpath\b|\$\{card\.count\}x/i;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__pycache__' || entry.startsWith('.')) {
      continue;
    }
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (EXTENSIONS.some(ext => entry.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

test('no source file assembles a card UID by hand', () => {
  const offenders: string[] = [];

  for (const root of SEARCH_ROOTS) {
    for (const file of walk(join(ROOT, root))) {
      const rel = relative(ROOT, file);
      if (ALLOWED.has(rel)) {
        continue;
      }
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (!UID_TEMPLATE.test(line) || NON_CARD_KEY.test(line)) {
            return;
          }
          offenders.push(`${rel}:${i + 1}  ${line.trim()}`);
        });
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `card UIDs must be built with cardUid()/cardUidOrName() from shared/data/cardIdentity.\n` +
      `Deck artifacts carry raw collector numbers and every other artifact carries padded ones,\n` +
      `so interpolating the fields silently misses ~24% of reprint mappings (D20).\n\n${offenders.join('\n')}`
  );
});

test('the allowlist stays honest — every entry still exists and still needs to', () => {
  for (const [rel, reason] of ALLOWED) {
    const full = join(ROOT, rel);
    assert.doesNotThrow(() => statSync(full), `allowlisted ${rel} no longer exists — drop the entry`);
    assert.ok(
      UID_TEMPLATE.test(readFileSync(full, 'utf8')),
      `allowlisted ${rel} no longer builds a UID by hand (${reason}) — drop the entry`
    );
  }
});
