#!/usr/bin/env tsx
/**
 * Repository metadata consistency check.
 *
 * Documentation and machine-readable repo state drift silently: a README table
 * advertises an npm script that was renamed, a workflow pins a Node major the
 * package no longer supports, two migration decisions end up sharing an ID. All
 * of those are cheap to assert and expensive to notice by eye, so they run in CI.
 *
 * Scope is deliberately narrow — facts that exist in two places and must agree.
 * Prose is not validated; that stays a human's job.
 *
 * Usage:
 *   npx tsx scripts/check-repo-metadata.ts          # report and exit non-zero on failure
 *   npx tsx scripts/check-repo-metadata.ts --quiet  # only print failures
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const QUIET = process.argv.includes('--quiet');

const failures: string[] = [];
const passes: string[] = [];

function check(name: string, run: () => string[] | void): void {
  let problems: string[];
  try {
    problems = run() ?? [];
  } catch (err) {
    problems = [`threw: ${err instanceof Error ? err.message : String(err)}`];
  }
  if (problems.length === 0) {
    passes.push(name);
    return;
  }
  for (const problem of problems) {
    failures.push(`${name}: ${problem}`);
  }
}

function readJson<T>(relPath: string): T {
  return JSON.parse(readFileSync(join(ROOT, relPath), 'utf8')) as T;
}

function readText(relPath: string): string {
  return readFileSync(join(ROOT, relPath), 'utf8');
}

interface PackageJson {
  engines?: { node?: string };
  scripts?: Record<string, string>;
}

interface SemanticDifference {
  id?: string;
  legacy?: string;
  decision?: string;
}

interface MigrationStatus {
  planDocument?: string;
  updatedAt?: string;
  currentPhase?: number;
  phases?: Record<string, { title?: string; status?: string; completedGates?: unknown; outstandingGates?: unknown }>;
  semanticDifferences?: SemanticDifference[];
  measuredBaselines?: { r2?: { inventoryFile?: string }; browser?: { benchmarkFile?: string } };
}

interface BuildGraph {
  schemaVersion?: number;
  nodes?: Array<{ name?: string; dependsOn?: string[] }>;
}

const pkg = readJson<PackageJson>('package.json');
const migration = readJson<MigrationStatus>('.github/data-migration-status.json');
const readme = readText('README.md');

/** Minimum supported Node major, from `engines.node` (the single source of truth). */
const supportedNodeMajor = (() => {
  const range = pkg.engines?.node ?? '';
  const match = range.match(/(\d+)/);
  if (!match) {
    throw new Error(`package.json engines.node is missing or unparseable: ${JSON.stringify(range)}`);
  }
  return Number(match[1]);
})();

// ---------------------------------------------------------------------------
// Migration status
// ---------------------------------------------------------------------------

check('migration decision IDs are unique', () => {
  const diffs = migration.semanticDifferences ?? [];
  if (diffs.length === 0) {
    return ['semanticDifferences is empty or missing'];
  }
  const seen = new Map<string, number>();
  const problems: string[] = [];
  diffs.forEach((diff, i) => {
    const { id } = diff;
    if (!id) {
      problems.push(`semanticDifferences[${i}] has no id`);
      return;
    }
    if (!/^D\d+$/.test(id)) {
      problems.push(`semanticDifferences[${i}] id ${JSON.stringify(id)} is not of the form D<number>`);
    }
    const first = seen.get(id);
    if (first !== undefined) {
      problems.push(`id ${id} is used by both semanticDifferences[${first}] and [${i}]`);
    } else {
      seen.set(id, i);
    }
  });
  return problems;
});

check('migration decisions each state a legacy behavior and a decision', () => {
  const problems: string[] = [];
  for (const diff of migration.semanticDifferences ?? []) {
    if (!diff.legacy?.trim()) {
      problems.push(`${diff.id ?? '<no id>'} has no "legacy" text`);
    }
    if (!diff.decision?.trim()) {
      problems.push(`${diff.id ?? '<no id>'} has no "decision" text`);
    }
  }
  return problems;
});

check('migration phases are well-formed and currentPhase exists', () => {
  const phases = migration.phases ?? {};
  const problems: string[] = [];
  const keys = Object.keys(phases);
  if (keys.length === 0) {
    return ['phases is empty or missing'];
  }
  for (const [key, phase] of Object.entries(phases)) {
    if (!/^\d+$/.test(key)) {
      problems.push(`phase key ${JSON.stringify(key)} is not a number`);
    }
    if (!phase.title?.trim()) {
      problems.push(`phase ${key} has no title`);
    }
    if (!phase.status?.trim()) {
      problems.push(`phase ${key} has no status`);
    }
    for (const field of ['completedGates', 'outstandingGates'] as const) {
      if (phase[field] !== undefined && !Array.isArray(phase[field])) {
        problems.push(`phase ${key}.${field} is not an array`);
      }
    }
  }
  if (migration.currentPhase !== undefined && !keys.includes(String(migration.currentPhase))) {
    problems.push(`currentPhase ${migration.currentPhase} has no entry in phases`);
  }
  return problems;
});

check('migration updatedAt is an ISO date', () => {
  const value = migration.updatedAt ?? '';
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? [] : [`updatedAt ${JSON.stringify(value)} is not YYYY-MM-DD`];
});

check('migration baseline files exist', () => {
  // `planDocument` is deliberately NOT checked: `*.md` is gitignored in this
  // repo, so the plan lives outside version control by convention.
  const referenced = [
    migration.measuredBaselines?.r2?.inventoryFile,
    migration.measuredBaselines?.browser?.benchmarkFile
  ];
  return referenced
    .filter((path): path is string => Boolean(path))
    .filter(path => !existsSync(join(ROOT, path)))
    .map(path => `referenced baseline ${path} does not exist`);
});

// ---------------------------------------------------------------------------
// Build graph
// ---------------------------------------------------------------------------

check('build graph node references resolve and the graph is acyclic', () => {
  const graph = readJson<BuildGraph>('.github/build-graph.json');
  const nodes = graph.nodes ?? [];
  if (nodes.length === 0) {
    return ['build-graph.json declares no nodes'];
  }
  const problems: string[] = [];
  const byName = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.name) {
      problems.push('a node has no name');
      continue;
    }
    if (byName.has(node.name)) {
      problems.push(`duplicate node name ${node.name}`);
    }
    byName.set(node.name, node.dependsOn ?? []);
  }
  for (const [name, deps] of byName) {
    for (const dep of deps) {
      if (!byName.has(dep)) {
        problems.push(`node ${name} depends on undeclared node ${dep}`);
      }
    }
  }

  // Iterative DFS: the graph is small, but a cycle must not blow the stack.
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const color = new Map<string, number>([...byName.keys()].map(name => [name, WHITE]));
  for (const start of byName.keys()) {
    if (color.get(start) !== WHITE) {
      continue;
    }
    const stack: Array<{ name: string; deps: string[]; i: number }> = [
      { name: start, deps: byName.get(start) ?? [], i: 0 }
    ];
    color.set(start, GREY);
    while (stack.length) {
      const frame = stack[stack.length - 1];
      if (frame.i >= frame.deps.length) {
        color.set(frame.name, BLACK);
        stack.pop();
        continue;
      }
      const dep = frame.deps[frame.i++];
      if (!byName.has(dep)) {
        continue;
      }
      if (color.get(dep) === GREY) {
        const from = stack.findIndex(f => f.name === dep);
        problems.push(`cycle: ${[...stack.slice(from).map(f => f.name), dep].join(' -> ')}`);
        continue;
      }
      if (color.get(dep) === WHITE) {
        color.set(dep, GREY);
        stack.push({ name: dep, deps: byName.get(dep) ?? [], i: 0 });
      }
    }
  }
  return problems;
});

// ---------------------------------------------------------------------------
// Documentation vs package.json
// ---------------------------------------------------------------------------

check('npm scripts named in README exist', () => {
  const scripts = pkg.scripts ?? {};
  const referenced = new Set<string>();
  for (const match of readme.matchAll(/`npm (?:run )?([a-z][a-z0-9:-]*)`/g)) {
    referenced.add(match[1]);
  }
  // `npm test` and `npm install` are npm builtins, not package scripts.
  referenced.delete('install');
  return [...referenced]
    .filter(name => name !== 'test' && !(name in scripts))
    .sort()
    .map(name => `README references \`npm run ${name}\` but package.json has no such script`);
});

check('README Node requirement matches package.json engines', () => {
  const problems: string[] = [];
  const prose = readme.match(/Requires Node (\d+)\+/);
  if (!prose) {
    problems.push('README has no "Requires Node <major>+" line');
  } else if (Number(prose[1]) !== supportedNodeMajor) {
    problems.push(`README says Node ${prose[1]}+ but package.json engines.node requires ${supportedNodeMajor}+`);
  }
  const badge = readme.match(/img\.shields\.io\/badge\/node-[^-]*?(\d+)-/);
  if (badge && Number(badge[1]) !== supportedNodeMajor) {
    problems.push(`README badge says Node ${badge[1]} but package.json engines.node requires ${supportedNodeMajor}+`);
  }
  return problems;
});

// ---------------------------------------------------------------------------
// Workflows
// ---------------------------------------------------------------------------

const WORKFLOW_DIR = join(ROOT, '.github/workflows');
const workflowFiles = readdirSync(WORKFLOW_DIR).filter(name => name.endsWith('.yml') || name.endsWith('.yaml'));

check('workflow node-version matches the supported Node major', () => {
  const problems: string[] = [];
  for (const file of workflowFiles) {
    const text = readFileSync(join(WORKFLOW_DIR, file), 'utf8');
    for (const match of text.matchAll(/node-version:\s*'?"?(\d+)/g)) {
      if (Number(match[1]) !== supportedNodeMajor) {
        problems.push(`${file} pins node-version ${match[1]}, expected ${supportedNodeMajor}`);
      }
    }
  }
  return problems;
});

check('script paths referenced by workflows exist', () => {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const file of workflowFiles) {
    const text = readFileSync(join(WORKFLOW_DIR, file), 'utf8');
    for (const match of text.matchAll(/(?:^|[\s'"`([])((?:\.github\/)?scripts\/[\w./-]+\.(?:ts|mts|mjs|js|py))/gm)) {
      const path = match[1];
      const dedupeKey = `${file}::${path}`;
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
      if (!existsSync(join(ROOT, path))) {
        problems.push(`${file} references ${path}, which does not exist`);
      }
    }
  }
  return problems;
});

check('workflows declare explicit permissions', () => {
  // A workflow with no `permissions:` block inherits the repository default,
  // which may be read-write on every scope. Least privilege has to be written down.
  return workflowFiles
    .filter(file => !/^\s*permissions:/m.test(readFileSync(join(WORKFLOW_DIR, file), 'utf8')))
    .map(file => `${file} declares no permissions block (inherits repository default)`);
});

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

if (!QUIET) {
  for (const name of passes) {
    console.log(`  ok   ${name}`);
  }
}
for (const failure of failures) {
  console.error(`  FAIL ${failure}`);
}

if (failures.length) {
  console.error(
    `\ncheck-repo-metadata: ${failures.length} problem(s) across ${passes.length + failures.length} checks`
  );
  process.exit(1);
}
if (!QUIET) {
  console.log(`\ncheck-repo-metadata: ${passes.length} checks passed`);
}
