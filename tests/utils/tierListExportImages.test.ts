/**
 * tests/utils/tierListExportImages.test.ts
 * Card art redrawn at its export size, on a stub DOM. The e2e suite covers the
 * real rasteriser; this covers which images get redrawn and how the small copy
 * finds its way into the clone.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { shrinkCardArt } from '../../src/lib/tierList/exportImages';

class StubElement {
  dataset: Record<string, string> = {};
  src = '';
  constructor(private readonly imgs: StubElement[] = []) {}
  querySelectorAll(): StubElement[] {
    return this.imgs;
  }
}

interface StubImg {
  src: string;
  currentSrc: string;
  naturalWidth: number;
  naturalHeight: number;
  getBoundingClientRect: () => { width: number };
}

const img = (url: string, naturalWidth: number, drawn: number): StubImg => ({
  src: url,
  currentSrc: url,
  naturalWidth,
  naturalHeight: Math.round(naturalWidth * 1.4),
  getBoundingClientRect: () => ({ width: drawn })
});

function stubDom(taint: (url: string) => boolean): { drawn: Array<[number, number]> } {
  const drawn: Array<[number, number]> = [];
  let current = '';
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      drawImage: (source: StubImg, _x: number, _y: number, w: number, h: number) => {
        current = source.src;
        drawn.push([w, h]);
      }
    }),
    toDataURL: () => {
      if (taint(current)) {
        throw new Error('tainted');
      }
      return `data:small:${current}`;
    }
  };
  Object.assign(globalThis, {
    document: { createElement: () => canvas },
    Element: StubElement
  });
  return { drawn };
}

test('card art is redrawn at its export size and swapped into the clone', () => {
  const { drawn } = stubDom(() => false);
  const board = {
    querySelectorAll: () => [img('/big', 245, 45), img('/small', 100, 45), img('/hidden', 245, 0)]
  } as unknown as HTMLElement;
  const onEmbed = shrinkCardArt(board, 2);

  // 45px drawn at 2x is 90px; a 100px file is within a quarter of that and is left alone.
  assert.deepEqual(drawn, [[90, Math.round(1.4 * 90)]]);

  const big = new StubElement();
  big.dataset.originalSrc = '/big';
  big.src = 'data:full';
  const small = new StubElement();
  small.dataset.originalSrc = '/small';
  small.src = 'data:full';
  onEmbed(new StubElement([big, small]) as unknown as Node);
  assert.equal(big.src, 'data:small:/big');
  assert.equal(small.src, 'data:full');
});

test('an image that taints the canvas is left at full size', () => {
  stubDom(url => url === '/remote');
  const board = { querySelectorAll: () => [img('/remote', 245, 45)] } as unknown as HTMLElement;
  const onEmbed = shrinkCardArt(board, 2);
  const remote = new StubElement();
  remote.dataset.originalSrc = '/remote';
  remote.src = 'data:full';
  onEmbed(new StubElement([remote]) as unknown as Node);
  assert.equal(remote.src, 'data:full');
  // Something that is not an element is passed over.
  onEmbed({} as Node);
});
