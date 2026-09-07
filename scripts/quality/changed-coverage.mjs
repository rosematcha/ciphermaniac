/** Added line numbers from a zero-context, single-file Git diff. */
export function addedLines(diff) {
  const result = new Set();
  let line = 0;
  for (const text of diff.split('\n')) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunk) {
      line = Number(hunk[1]);
    } else if (text.startsWith('+') && !text.startsWith('+++')) {
      result.add(line++);
    } else if (text.startsWith(' ')) {
      line++;
    }
  }
  return result;
}

export function changedLineCoverage(lines, coverage) {
  const executable = [...lines].filter(line => Object.hasOwn(coverage, line));
  const uncovered = executable.filter(line => coverage[line] === 0);
  return {
    executable: executable.length,
    uncovered,
    percent: executable.length ? 100 * (1 - uncovered.length / executable.length) : 100
  };
}
