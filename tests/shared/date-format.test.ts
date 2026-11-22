import assert from 'node:assert/strict';
import test from 'node:test';

import { dateFormatter } from '../../shared/data/dateFormat.ts';

test('a cached formatter formats as toLocaleDateString does, and is built once per option set', () => {
  const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
  const date = new Date(2026, 10, 21);
  assert.equal(dateFormatter(options).format(date), date.toLocaleDateString(undefined, options));
  assert.equal(dateFormatter({ ...options }), dateFormatter(options));
  assert.notEqual(dateFormatter({ month: 'long' }), dateFormatter(options));
});
