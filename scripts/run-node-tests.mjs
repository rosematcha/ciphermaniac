import { readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const testsRoot = join(projectRoot, 'tests');
const excludedDirectories = new Set(['e2e', 'mobile', 'perf']);

async function collectTestFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name) || directory !== testsRoot) {
        files.push(...(await collectTestFiles(join(directory, entry.name))));
      }
      continue;
    }
    if (entry.isFile() && /\.test\.(?:ts|mjs)$/.test(entry.name)) {
      files.push(join(directory, entry.name));
    }
  }
  return files;
}

function suiteFiles(files, suite) {
  const relativeFiles = files.map(file => relative(testsRoot, file).split(sep).join('/'));
  if (suite === 'api') {
    return files.filter((_, index) => relativeFiles[index].startsWith('api/'));
  }
  if (suite === 'unit') {
    return files.filter((_, index) => !relativeFiles[index].startsWith('api/'));
  }
  if (suite === 'node') {
    return files;
  }
  throw new Error(`Unknown test suite "${suite}". Expected unit, api, or node.`);
}

const suite = process.argv[2] ?? 'node';
const files = suiteFiles(await collectTestFiles(testsRoot), suite);
if (files.length === 0) {
  throw new Error(`No Node test files found for suite "${suite}".`);
}

const child = spawn(process.execPath, ['--test', '--import', 'tsx', ...process.argv.slice(3), ...files], {
  cwd: projectRoot,
  stdio: 'inherit'
});

child.once('error', error => {
  throw error;
});
child.once('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  }
  process.exit(code ?? 1);
});
