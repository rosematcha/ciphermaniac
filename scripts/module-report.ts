#!/usr/bin/env tsx
/**
 * Module responsibility report.
 *
 * DB-MASTER-PLAN Phase 17 asks for a soft signal, explicitly NOT a line-count
 * gate: the question is "is this module accumulating unrelated
 * responsibilities", not "is this file over 300 lines". A 600-line module that
 * does one thing is fine; a 300-line one that fetches, transforms, formats, and
 * renders is not.
 *
 * So the score is not length. It is how many distinct KINDS of work a module
 * does, weighted by size — imports that reveal a concern (network, storage,
 * reactivity, DOM, filesystem), plus export count and fan-in. Length only
 * amplifies a module that already looks mixed.
 *
 * Deliberately a report, not a gate. It has no threshold to game and fails
 * nothing; run it when deciding what to refactor next.
 *
 * Usage:
 *   npx tsx scripts/module-report.ts           # top 15 by score
 *   npx tsx scripts/module-report.ts 30        # top N
 *   npx tsx scripts/module-report.ts --churn   # weight by git change frequency
 */

import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = ['src', 'shared', 'functions', 'scripts', '.github/scripts'];
const EXTENSIONS = ['.ts', '.tsx', '.mts', '.mjs'];

const topN = Number(process.argv.find(a => /^\d+$/.test(a)) ?? 15);
const useChurn = process.argv.includes('--churn');

/**
 * Concerns a module can take on. A module touching several of these is doing
 * several kinds of work, which is the thing worth noticing.
 */
const CONCERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'network', pattern: /\bfetch\(|XMLHttpRequest|axios/ },
  { name: 'storage', pattern: /@aws-sdk|R2Bucket|localStorage|sessionStorage|KVNamespace|D1Database/ },
  { name: 'filesystem', pattern: /from 'node:fs'|require\('fs'\)|readFileSync|writeFile/ },
  // Reactivity, DOM, JSX and routing are inseparable in a Solid page — a page
  // using all four is BEING a page, not mixing concerns. Counting them
  // separately just ranked pages by length, which is the line-count gate this
  // report exists to avoid. One "ui" concern; what matters is what a page does
  // BESIDES rendering.
  {
    name: 'ui',
    pattern:
      /createSignal|createMemo|createResource|createEffect|document\.|window\.|<\/[A-Za-z]|useNavigate|@solidjs\/router/
  },
  { name: 'formatting', pattern: /toLocaleDateString|toLocaleString|toFixed\(|padStart\(/ },
  { name: 'parsing', pattern: /JSON\.parse|\.match\(\/|new RegExp/ },
  { name: 'aggregation', pattern: /\.reduce\(|new Map\(|new Set\(/ }
];

interface ModuleStat {
  path: string;
  lines: number;
  exports: number;
  concerns: string[];
  fanIn: number;
  churn: number;
  score: number;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__pycache__' || entry.startsWith('.')) {
      continue;
    }
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (EXTENSIONS.some(ext => entry.endsWith(ext)) && !entry.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

function changeCount(rel: string): number {
  if (!useChurn) {
    return 0;
  }
  try {
    const out = execSync(`git log --oneline --follow -- ${JSON.stringify(rel)}`, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return out.trim() ? out.trim().split('\n').length : 0;
  } catch {
    return 0;
  }
}

/**
 * Remove comments and string/template bodies before looking for concerns.
 *
 * Without this the scan reads prose: `window.` matched the phrase "rolling
 * 14-day window." inside an empty-state message and reported a pure model as
 * touching the DOM. Concerns must come from code, not from copy.
 */
function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``');
}

const files = ROOTS.flatMap(r => walk(join(ROOT, r)));
const sources = new Map<string, string>();
for (const file of files) {
  // The reporter's own concern patterns are string literals that would match
  // themselves; it is a tool, not a module under review.
  if (file === fileURLToPath(import.meta.url)) {
    continue;
  }
  sources.set(file, readFileSync(file, 'utf8'));
}

/** How many other modules import this one, by filename stem. */
function fanInFor(file: string): number {
  const stem =
    file
      .replace(/\.[^.]+$/, '')
      .split('/')
      .pop() ?? '';
  if (!stem) {
    return 0;
  }
  const needle = new RegExp(`from '[^']*/${stem}(\\.[a-z]+)?'`);
  let count = 0;
  for (const [other, text] of sources) {
    if (other !== file && needle.test(text)) {
      count += 1;
    }
  }
  return count;
}

const stats: ModuleStat[] = [];
for (const [file, text] of sources) {
  const rel = relative(ROOT, file);
  const lines = text.split('\n').length;
  const exports = (text.match(/^export /gm) ?? []).length;
  const code = codeOnly(text);
  const concerns = CONCERNS.filter(c => c.pattern.test(code)).map(c => c.name);
  const fanIn = fanInFor(file);
  const churn = changeCount(rel);
  // Mixedness leads; size only amplifies something already mixed. A module
  // with one concern scores near zero no matter how long it is.
  const mixedness = Math.max(0, concerns.length - 2);
  const score = mixedness * Math.log2(lines + 1) * (1 + exports / 20) * (1 + fanIn / 10) * (1 + churn / 10);
  stats.push({ path: rel, lines, exports, concerns, fanIn, churn, score });
}

stats.sort((a, b) => b.score - a.score);

console.log(`Module responsibility report — ${stats.length} modules${useChurn ? ', churn-weighted' : ''}`);
console.log('Score rises with the number of DISTINCT concerns a module mixes, amplified by');
console.log('size, exports, and fan-in. One or two concerns scores zero at any length.\n');
console.log(`${'score'.padStart(6)}  ${'lines'.padStart(5)}  ${'exp'.padStart(3)}  ${'in'.padStart(3)}  path`);
for (const s of stats.slice(0, topN)) {
  console.log(
    `${s.score.toFixed(1).padStart(6)}  ${String(s.lines).padStart(5)}  ${String(s.exports).padStart(3)}  ` +
      `${String(s.fanIn).padStart(3)}  ${s.path}`
  );
  console.log(`${' '.repeat(21)}${s.concerns.join(', ')}`);
}

const clean = stats.filter(s => s.score === 0).length;
console.log(`\n${clean} of ${stats.length} modules mix two or fewer concerns.`);
