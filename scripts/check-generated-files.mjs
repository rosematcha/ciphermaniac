import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { forbiddenGeneratedFiles } from './quality/generated-files.mjs';

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0');
const forbidden = forbiddenGeneratedFiles(files);
const baseline = JSON.parse(readFileSync('config/quality/maintainability.json', 'utf8'));
const stale = Object.keys(baseline).filter(file => !existsSync(file));
for (const file of forbidden) {
  console.error(`Generated output must remain outside Git: ${file}`);
}
for (const file of stale) {
  console.error(`Remove maintainability exceptions for deleted file: ${file}`);
}
process.exitCode = forbidden.length || stale.length ? 1 : 0;
