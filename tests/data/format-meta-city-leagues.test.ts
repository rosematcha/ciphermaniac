/**
 * City Leagues through the format runner: the source gathers from saved
 * limitlesstcg.com pages, and the report is published like any format's.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as cheerio from 'cheerio';

import { runFormatMetas } from '../../.github/scripts/lib/formatMeta';
import type { OnlineMetaStore } from '../../.github/scripts/lib/onlineMeta';
import { NotFoundError } from '../../.github/scripts/lib/cityLeagues/fetch';
import { FORMAT_SCOPES, type FormatScope } from '../../shared/formats/registry';

const LIMITLESS = 'https://limitlesstcg.com';
const CITY = FORMAT_SCOPES.find(format => format.id === 'city-leagues') as FormatScope;
const fixture = (name: string) => readFileSync(new URL(`../fixtures/city-leagues/${name}`, import.meta.url), 'utf8');

function oneEventListing(): string {
  const $ = cheerio.load(fixture('listing.html'));
  $('tr[data-date]').slice(1).remove();
  $('ul.pagination').attr('data-max', '1');
  return $.html();
}

test('City Leagues publishes a settled two-week report with no matchups', async () => {
  const objects = new Map<string, unknown>([['assets/card-synonyms.json', { synonyms: { x: 'x' }, canonicals: {} }]]);
  const store: OnlineMetaStore = {
    read: async <T>(key: string) => (objects.get(key) as T | undefined) ?? null,
    async write(key, value) {
      objects.set(key, value);
    },
    list: async prefix => [...objects.keys()].filter(key => key.startsWith(prefix)),
    async remove(keys) {
      keys.forEach(key => objects.delete(key));
      return keys.length;
    }
  };
  const pages: Record<string, string> = {
    [`${LIMITLESS}/tournaments/jp?show=100&page=1`]: oneEventListing(),
    [`${LIMITLESS}/tournaments/jp/5150`]: fixture('event-5150.html')
  };
  const fetchPageText = async (url: string) => {
    if (pages[url]) {
      return pages[url];
    }
    if (url.startsWith(`${LIMITLESS}/decks/list/jp/`)) {
      return fixture('decklist-76771.html');
    }
    throw new NotFoundError(url);
  };
  const playCalls: string[] = [];

  const index = await runFormatMetas({
    store,
    fetchJson: async path => {
      playCalls.push(path);
      return [];
    },
    limitlessApiKey: 'test-key',
    now: new Date('2026-11-04T03:00:00Z'),
    reportsPrefix: 'reports',
    formats: [CITY],
    fetchPageText,
    log: () => undefined,
    warn: () => undefined
  });

  assert.deepEqual(
    index.formats.map(entry => [entry.id, entry.label, entry.events, entry.decks]),
    [['city-leagues', 'City Leagues', 1, 16]]
  );
  const meta = objects.get('reports/Formats/city-leagues/meta.json') as Record<string, unknown>;
  assert.equal(meta.source, 'limitless-jp');
  assert.equal(meta.windowStart, '2026-10-14T00:00:00.000Z');
  assert.equal(meta.windowEnd, '2026-10-28T00:00:00.000Z');
  // No City League event is looked up on Limitless Play.
  assert.ok(playCalls.every(path => !path.startsWith('/tournaments')));
});
