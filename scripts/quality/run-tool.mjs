import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const venv = join(root, '.venv', process.platform === 'win32' ? 'Scripts' : 'bin');
const [tool, ...args] = process.argv.slice(2);
if (!tool) {
  throw new Error('Expected a tool name');
}
const local = join(venv, process.platform === 'win32' ? `${tool}.exe` : tool);
const executable = tool === 'python' ? (process.env.PYTHON ?? (existsSync(local) ? local : 'python3')) : tool;
const result = spawnSync(executable, args, {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, PATH: `${venv}${delimiter}${process.env.PATH ?? ''}` }
});
if (result.error) {
  console.error(
    `Cannot run ${tool}: ${result.error.message}. Install .github/scripts/requirements-quality.txt in .venv.`
  );
}
process.exit(result.status ?? 1);
