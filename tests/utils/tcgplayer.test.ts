import assert from 'node:assert/strict';
import test from 'node:test';
import { tcgplayerAffiliateUrl } from '../../src/utils/tcgplayer.js';

test('product links retain the selected printing and use our Impact account', () => {
  for (const id of ['654453', '610428']) {
    const destination = `https://www.tcgplayer.com/product/${id}`;
    const result = new URL(tcgplayerAffiliateUrl(destination));
    assert.equal(result.origin, 'https://partner.tcgplayer.com');
    assert.equal(result.pathname, '/c/6491809/1780961/21018');
    assert.equal(result.searchParams.get('u'), destination);
    assert.equal([...result.searchParams].length, 1);
  }
});

test('search filters and fragments survive exactly one level of affiliate encoding', () => {
  const destination = 'https://www.tcgplayer.com/search/pokemon/product?q=Pok%C3%A9mon&view=grid#list';
  const result = new URL(tcgplayerAffiliateUrl(destination));
  assert.equal(result.searchParams.get('u'), destination);
  assert.equal(result.searchParams.has('view'), false);
  assert.equal(result.hash, '');
});

test('the bare shop domain is also supported', () => {
  const result = new URL(tcgplayerAffiliateUrl('https://tcgplayer.com'));
  assert.equal(result.searchParams.get('u'), 'https://tcgplayer.com/');
});

test('asset requests, existing affiliate links, and non-shopping destinations are rejected', () => {
  for (const destination of [
    'https://tcgplayer-cdn.tcgplayer.com/product/714372_200w.jpg',
    'https://partner.tcgplayer.com/c/6491809/1780961/21018',
    'https://www.tcgplayer.com.example.com/product/1',
    'https://example.com/?u=https://www.tcgplayer.com',
    'http://www.tcgplayer.com/product/1',
    'https://user:password@www.tcgplayer.com/product/1',
    '/product/1'
  ]) {
    assert.throws(() => tcgplayerAffiliateUrl(destination));
  }
});
