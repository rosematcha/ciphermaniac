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
 * Ways to assemble the three-part `Name::SET::NUMBER` card-UID shape.
 *
 * Scoped to THREE segments on purpose. The two-part `SET::NUMBER` form is a
 * different key (zero-STRIPPED, used for snapshot/card-type/sitemap indexes)
 * with its own constructors — `cardNumberIndexKey` and `cardRouteKey`. Lumping
 * them together made this guard fire on legitimate index builders and deck
 * fingerprints, which is how a guard earns a blanket ignore.
 *
 * An adversarial review defeated the first version three ways, so all three are
 * covered now: a template literal, `.join('::')`, and `+` concatenation. This is
 * still a text search, not a parser — someone determined to route around it
 * can. It exists to catch the ACCIDENTAL fourteenth call site, which is what
 * D20 actually was.
 */
const UID_PATTERNS: RegExp[] = [
  // `${name}::${set}::${number}` — the original shape.
  /`[^`]*\$\{[^}]*\}::\$\{[^}]*\}::\$\{/,
  // [name, set, number].join('::') — any three-element array joined on '::'.
  /\[[^\]]+,[^\]]+,[^\]]+\]\s*\.join\(\s*['"`]::['"`]/,
  // name + '::' + set + '::' + number
  /['"`]::['"`]\s*\+[\s\S]{0,80}?['"`]::['"`]\s*\+/
];

/**
 * `::`-joined strings that are not card identity at all.
 *
 * Deliberately matched against the code BEFORE its trailing comment: the first
 * version tested the whole line, so any real violation could be silenced by
 * writing `// read from file` after it.
 */
const NON_CARD_KEY = /tournament|archetypeBase|dateIso|placing|player|entry\.|\bpath\b|\$\{card\.count\}x/i;

/** Strip a trailing line comment so it cannot suppress a real finding. */
function codeOnly(line: string): string {
  const idx = line.indexOf('//');
  return idx >= 0 ? line.slice(0, idx) : line;
}

/**
 * Collapse a file to one comment-free line per statement-ish unit.
 *
 * A line-by-line scan is defeated by breaking the expression across a newline —
 * which a formatter can do by accident on a long line, not just an author
 * evading on purpose. Joining the code lines with a single space and scanning
 * the whole thing closes that, at the cost of a pattern being able to span two
 * genuinely unrelated statements. The patterns are specific enough
 * (`}::${`, a three-element array `.join('::')`, two `'::'` operands) that this
 * has not produced a false positive on this repo; the second test below is what
 * would catch it if it started to.
 */
function scannableSource(text: string): string {
  return text.split('\n').map(codeOnly).join(' ').replace(/\s+/g, ' ');
}

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
      const text = readFileSync(file, 'utf8');
      // Line scan first, so a finding can be reported at its line.
      let reported = false;
      text.split('\n').forEach((line, i) => {
        const code = codeOnly(line);
        if (!UID_PATTERNS.some(re => re.test(code)) || NON_CARD_KEY.test(code)) {
          return;
        }
        offenders.push(`${rel}:${i + 1}  ${line.trim()}`);
        reported = true;
      });
      // Then the whole-file scan, which catches expressions split across lines.
      if (!reported) {
        const joined = scannableSource(text);
        if (UID_PATTERNS.some(re => re.test(joined)) && !NON_CARD_KEY.test(joined)) {
          offenders.push(`${rel}  (card UID assembled across multiple lines)`);
        }
      }
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
      UID_PATTERNS.some(re => re.test(readFileSync(full, 'utf8'))),
      `allowlisted ${rel} no longer builds a UID by hand (${reason}) — drop the entry`
    );
  }
});

/* eslint-disable no-template-curly-in-string -- these strings ARE the code samples under test */
test('the guard catches the evasions an adversarial review found', () => {
  // The first version matched only a single-line template literal and tested
  // NON_CARD_KEY against the whole line, so join(), concatenation, and a
  // trailing comment each defeated it.
  const evasions = [
    "const uid = [name, set, number].join('::');",
    "const uid = name + '::' + set + '::' + number;",
    'const uid = `${name}::${set}::${number}`; // read from file'
  ];
  for (const line of evasions) {
    const code = codeOnly(line);
    assert.ok(UID_PATTERNS.some(re => re.test(code)) && !NON_CARD_KEY.test(code), `guard does not catch: ${line}`);
  }
});

test('the guard still ignores the two-part index-key form and deck fingerprints', () => {
  const allowed = [
    'return `${set.toUpperCase()}::${cardNumberIndexKey(number)}`;',
    'const cacheKey = `${tournament}::${archetypeBase}`;',
    ".map(card => `${card.count}x${card.name || ''}::${card.set || ''}::${card.number || ''}`)"
  ];
  for (const line of allowed) {
    const code = codeOnly(line);
    assert.ok(!UID_PATTERNS.some(re => re.test(code)) || NON_CARD_KEY.test(code), `guard falsely flags: ${line}`);
  }
});
/* eslint-enable no-template-curly-in-string */

/* eslint-disable no-template-curly-in-string -- these strings ARE the code samples under test */
test('the guard catches a UID split across lines', () => {
  // A line-by-line scan misses these, and a formatter can produce them by
  // accident on a long line — not just an author evading deliberately.
  const multiline = [
    'const uid = `${name}::${\n  set\n}::${number}`;',
    "const uid = [name, set, number]\n  .join('::');",
    "const uid = name + '::' +\n  set + '::' + number;"
  ];
  for (const sample of multiline) {
    const joined = scannableSource(sample);
    assert.ok(
      UID_PATTERNS.some(re => re.test(joined)),
      `guard misses across lines: ${JSON.stringify(sample)}`
    );
  }
});
/* eslint-enable no-template-curly-in-string */
