/**
 * ACE SPEC overlay for the card-types database. Limitless card pages carry no
 * ACE SPEC marker, so build-card-types.mjs reads the site's `is:ace` search and
 * stamps the flag across the whole database. The fixture mirrors the live
 * list-view markup of limitlesstcg.com/cards?q=is:ace (August 2026).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aceSpecLookupKey, applyAceSpecFlags, parseAceSpecList } from '../../scripts/build-card-types.mjs';

const SEARCH_LIST_PAGE = `
<a href="/cards/advanced">Advanced search</a>
<a href="/cards/de/TEF/157">German print</a>
<table class="data-table">
  <tr><th>Set</th><th>No.</th><th>Name</th></tr>
  <tr>
    <td><a href="/cards/TEF"><img class="set" alt="TEF"></a></td>
    <td>157</td>
    <td><a href="/cards/TEF/157">Prime Catcher</a></td>
    <td>Item</td>
  </tr>
  <tr>
    <td><a href="/cards/SFA"><img class="set" alt="SFA"></a></td>
    <td>58</td>
    <td><a href="/cards/SFA/58">Dangerous Laser</a></td>
    <td>Item</td>
  </tr>
  <tr>
    <td><a href="/cards/TWM"><img class="set" alt="TWM"></a></td>
    <td>167</td>
    <td><a href="/cards/TWM/167">Legacy Energy</a></td>
    <td>Special Energy</td>
  </tr>
</table>`;

void test('normalizes set/number pairs past the database zero-padding', () => {
  assert.equal(aceSpecLookupKey('SFA', '058'), 'SFA::58');
  assert.equal(aceSpecLookupKey('SFA', '58'), 'SFA::58');
  assert.equal(aceSpecLookupKey('sfa', 58), 'SFA::58');
  // Non-numeric numbers (Crown Zenith galleries) are only uppercased.
  assert.equal(aceSpecLookupKey('CRZ', 'gg40'), 'CRZ::GG40');
  assert.equal(aceSpecLookupKey('', '58'), null);
  assert.equal(aceSpecLookupKey('SFA', ''), null);
});

void test('extracts card keys from the search list, ignoring nav and localized links', () => {
  const keys = parseAceSpecList(SEARCH_LIST_PAGE).sort();
  assert.deepEqual(keys, ['SFA::58', 'TEF::157', 'TWM::167']);
});

/** Just the fields the overlay reads and writes. */
type Entry = { cardType: string; subType: string; aceSpec?: boolean };

void test('flags database entries in both directions', () => {
  const database: Record<string, Entry> = {
    'TEF::157': { cardType: 'trainer', subType: 'item' },
    'SFA::058': { cardType: 'trainer', subType: 'item' },
    'TWM::167': { cardType: 'energy', subType: 'special' },
    'TWM::130': { cardType: 'trainer', subType: 'supporter' },
    // A flag left over from a card that is no longer in the list.
    'TEF::999': { cardType: 'trainer', subType: 'item', aceSpec: true }
  };

  const result = applyAceSpecFlags(database, new Set(parseAceSpecList(SEARCH_LIST_PAGE)));

  assert.deepEqual(result, { added: 3, removed: 1, total: 3 });
  assert.equal(database['TEF::157'].aceSpec, true);
  // Zero-padded database key against an unpadded search result.
  assert.equal(database['SFA::058'].aceSpec, true);
  // Special-energy ACE SPECs are flagged too.
  assert.equal(database['TWM::167'].aceSpec, true);
  assert.equal(database['TWM::130'].aceSpec, undefined);
  assert.equal(database['TEF::999'].aceSpec, undefined);
  // Subtypes are untouched — an ACE SPEC keeps being an Item.
  assert.equal(database['TEF::157'].subType, 'item');
});

void test('a second pass reports no changes', () => {
  const database: Record<string, Entry> = { 'TEF::157': { cardType: 'trainer', subType: 'item' } };
  const keys = new Set(parseAceSpecList(SEARCH_LIST_PAGE));
  applyAceSpecFlags(database, keys);
  assert.deepEqual(applyAceSpecFlags(database, keys), { added: 0, removed: 0, total: 1 });
});

void test('a missing list leaves stored flags alone', () => {
  const database: Record<string, Entry> = { 'TEF::157': { cardType: 'trainer', subType: 'item', aceSpec: true } };
  assert.deepEqual(applyAceSpecFlags(database, null), { added: 0, removed: 0, total: 0 });
  assert.equal(database['TEF::157'].aceSpec, true);
});
