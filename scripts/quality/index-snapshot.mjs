import { execFileSync } from 'node:child_process';
import { existsSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';

/** Materialize the index so unstaged fixes cannot make a broken commit pass. */
export function checkoutIndex(repository, directory) {
  const git = args => execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();
  git(['checkout-index', '--all', `--prefix=${directory}${sep}`]);
  writeFileSync(join(directory, '.git'), `gitdir: ${git(['rev-parse', '--absolute-git-dir'])}\n`);
  for (const name of ['node_modules', '.venv']) {
    const source = join(repository, name);
    if (existsSync(source)) {
      symlinkSync(source, join(directory, name), 'junction');
    }
  }
}
