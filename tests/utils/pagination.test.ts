import assert from 'node:assert/strict';
import test from 'node:test';

import { createQueryPageSignal } from '../../src/lib/pagination.ts';

test('query page defaults invalid and first-page values to one', () => {
  for (const raw of [undefined, '', '0', '1', '-2', '2.5', 'nope']) {
    const [page] = createQueryPageSignal(
      () => raw,
      () => undefined
    );
    assert.equal(page(), 1);
  }
});

test('query page reads and writes non-default pages', () => {
  let raw: string | undefined = '3';
  const [page, setPage] = createQueryPageSignal(
    () => raw,
    value => {
      raw = value;
    }
  );

  assert.equal(page(), 3);
  assert.equal(
    setPage(current => current + 1),
    4
  );
  assert.equal(raw, '4');
  assert.equal(setPage(1), 1);
  assert.equal(raw, undefined);
});
