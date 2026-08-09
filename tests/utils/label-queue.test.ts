import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPrintDocument,
  loadQueue,
  parseQueue,
  QUEUE_STORAGE_KEY,
  type QueuedLabel,
  queueLabelName,
  resolveDims,
  saveQueue
} from '../../src/lib/labelmaker/queue.ts';
import { defaultConfig } from '../../src/lib/labelmaker/types.ts';

/** Minimal in-memory Storage, enough for the queue's getItem/setItem use. */
function memoryStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => map.delete(k) as unknown as void,
    setItem: (k: string, v: string) => void map.set(k, v)
  };
}

const item = (over: Partial<QueuedLabel> = {}): QueuedLabel => ({
  id: 'a',
  config: { ...defaultConfig, title: 'Gardevoir ex' },
  size: { printerId: 'ql800', labelId: 'dk1209', custom: null },
  ...over
});

test('resolveDims follows the preset, and clamps nonsense custom geometry', () => {
  const preset = resolveDims({ printerId: 'ql800', labelId: 'dk2205-29', custom: null });
  assert.strictEqual(preset.wDots, 696);
  assert.strictEqual(preset.hMm, 29);

  // A half-typed number field must not produce a zero-dot canvas.
  const clamped = resolveDims({ printerId: 'ql800', labelId: 'dk1209', custom: { wMm: 0, hMm: 0, dpi: 0 } });
  assert.deepStrictEqual({ wMm: clamped.wMm, hMm: clamped.hMm, dpi: clamped.dpi }, { wMm: 62, hMm: 29, dpi: 300 });
});

test('an unknown printer or label falls back rather than throwing', () => {
  const dims = resolveDims({ printerId: 'nope', labelId: 'also-nope', custom: null });
  assert.ok(dims.wDots > 0 && dims.hDots > 0);
});

test('the queue survives a storage round-trip', () => {
  const storage = memoryStorage();
  const queue = [item(), item({ id: 'b', config: { ...defaultConfig, title: 'Dragapult ex' } })];
  saveQueue(storage, queue);
  assert.deepStrictEqual(loadQueue(storage), queue);
});

test('an absent or corrupt payload loads as an empty queue, not a crash', () => {
  assert.deepStrictEqual(loadQueue(memoryStorage()), []);
  assert.deepStrictEqual(loadQueue(memoryStorage({ [QUEUE_STORAGE_KEY]: '{not json' })), []);
  assert.deepStrictEqual(loadQueue(memoryStorage({ [QUEUE_STORAGE_KEY]: '{"a":1}' })), []);
});

test('partial stored entries fill in from the defaults instead of dropping the queue', () => {
  // A queue written before a config field existed must still open.
  const parsed = parseQueue('[{"id":"x","config":{"title":"Half a label","stars":"three"}}]');
  assert.strictEqual(parsed.length, 1);
  assert.strictEqual(parsed[0].config.title, 'Half a label');
  // 'three' is not a number, so the default stands.
  assert.strictEqual(parsed[0].config.stars, defaultConfig.stars);
  assert.strictEqual(parsed[0].config.layout, defaultConfig.layout);
  assert.strictEqual(parsed[0].size.custom, null);
});

test('queueLabelName falls back through title, subtitle, then a placeholder', () => {
  assert.strictEqual(queueLabelName(item()), 'Gardevoir ex');
  assert.strictEqual(
    queueLabelName(item({ config: { ...defaultConfig, subtitle: 'Standard 2026' } })),
    'Standard 2026'
  );
  assert.strictEqual(queueLabelName(item({ config: { ...defaultConfig } })), 'Untitled label');
});

test('a batch of one prints one page at its exact physical size', () => {
  const doc = buildPrintDocument([{ dataUrl: 'data:image/png;base64,AAA', dims: resolveDims(item().size) }], 'one');
  assert.match(doc, /@page lbl0 \{ size: 62mm 29mm; margin: 0; \}/);
  assert.strictEqual(doc.match(/<img /g)?.length, 1);
  // The lone sheet must not trail a blank page.
  assert.match(doc, /\.sheet:last-child \{ break-after: auto/);
});

test('a mixed-size batch gets one named page per distinct geometry', () => {
  const small = resolveDims({ printerId: 'ql800', labelId: 'dk1209', custom: null });
  const tall = resolveDims({ printerId: 'ql800', labelId: 'dk2205-100', custom: null });
  const doc = buildPrintDocument(
    [
      { dataUrl: 'data:1', dims: small },
      { dataUrl: 'data:2', dims: tall },
      { dataUrl: 'data:3', dims: small }
    ],
    'batch'
  );
  // Three labels, two page definitions — the repeat size is not redeclared.
  assert.strictEqual(doc.match(/<img /g)?.length, 3);
  assert.strictEqual(doc.match(/@page /g)?.length, 2);
  assert.match(doc, /@page lbl0 \{ size: 62mm 29mm/);
  assert.match(doc, /@page lbl1 \{ size: 100mm 62mm/);
  // The third label reuses the first page name.
  assert.strictEqual(doc.match(/class="sheet lbl0"/g)?.length, 2);
});

test('the document title is escaped', () => {
  const doc = buildPrintDocument([{ dataUrl: 'data:1', dims: resolveDims(item().size) }], '<script>x</script>');
  assert.ok(!doc.includes('<script>'));
  assert.match(doc, /&lt;script&gt;/);
});
