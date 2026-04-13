import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveCategorySlug,
  getCategorySortWeight,
  getUsagePercent,
  inferPrimaryCategory,
  isAceSpec,
  toLower
} from '../../src/archetype/cardCategories.ts';

// ---------------------------------------------------------------------------
// toLower
// ---------------------------------------------------------------------------

test('toLower converts strings to lowercase', () => {
  assert.equal(toLower('Hello'), 'hello');
});

test('toLower returns empty string for non-string', () => {
  assert.equal(toLower(null), '');
  assert.equal(toLower(undefined), '');
  assert.equal(toLower(42), '');
});

// ---------------------------------------------------------------------------
// inferPrimaryCategory
// ---------------------------------------------------------------------------

test('inferPrimaryCategory returns pokemon for null/undefined', () => {
  assert.equal(inferPrimaryCategory(null), 'pokemon');
  assert.equal(inferPrimaryCategory(undefined), 'pokemon');
});

test('inferPrimaryCategory infers from category field', () => {
  assert.equal(inferPrimaryCategory({ category: 'Pokemon' }), 'pokemon');
  assert.equal(inferPrimaryCategory({ category: 'Trainer/Item' }), 'trainer');
  assert.equal(inferPrimaryCategory({ category: 'Energy/Basic' }), 'energy');
});

test('inferPrimaryCategory infers trainer from trainerType', () => {
  assert.equal(inferPrimaryCategory({ trainerType: 'supporter' }), 'trainer');
});

test('inferPrimaryCategory infers energy from energyType', () => {
  assert.equal(inferPrimaryCategory({ energyType: 'basic' }), 'energy');
});

test('inferPrimaryCategory infers trainer from name keywords', () => {
  assert.equal(inferPrimaryCategory({ name: "Professor's Research" }), 'trainer');
  assert.equal(inferPrimaryCategory({ name: "Boss's Orders" }), 'trainer');
});

test('inferPrimaryCategory infers trainer from uid keywords', () => {
  assert.equal(inferPrimaryCategory({ uid: "boss's orders" }), 'trainer');
});

test('inferPrimaryCategory infers energy from name ending', () => {
  assert.equal(inferPrimaryCategory({ name: 'Fire Energy' }), 'energy');
});

test('inferPrimaryCategory infers energy from uid ending', () => {
  assert.equal(inferPrimaryCategory({ uid: 'water energy' }), 'energy');
});

test('inferPrimaryCategory infers energy from uid with :: separator', () => {
  assert.equal(inferPrimaryCategory({ uid: 'fire energy::SVI' }), 'energy');
});

test('inferPrimaryCategory infers energy from name with energy mid-word', () => {
  assert.equal(inferPrimaryCategory({ name: 'Double Turbo Energy card' }), 'energy');
});

test('inferPrimaryCategory defaults to pokemon for unknown cards', () => {
  assert.equal(inferPrimaryCategory({ name: 'Pikachu' }), 'pokemon');
});

// ---------------------------------------------------------------------------
// deriveCategorySlug
// ---------------------------------------------------------------------------

test('deriveCategorySlug returns full slug from category field', () => {
  assert.equal(deriveCategorySlug({ category: 'trainer/item' }), 'trainer/item');
  assert.equal(deriveCategorySlug({ category: 'energy/basic' }), 'energy/basic');
});

test('deriveCategorySlug enriches bare trainer category', () => {
  const slug = deriveCategorySlug({ category: 'Trainer', name: 'Iono' });
  assert.ok(slug.startsWith('trainer'));
  assert.ok(slug.includes('supporter'));
});

test('deriveCategorySlug enriches bare energy category', () => {
  const slug = deriveCategorySlug({ category: 'Energy', energyType: 'basic' });
  assert.equal(slug, 'energy/basic');
});

test('deriveCategorySlug infers trainer slug from name', () => {
  const slug = deriveCategorySlug({ name: "Boss's Orders" });
  assert.ok(slug.startsWith('trainer'));
});

test('deriveCategorySlug handles ace spec cards', () => {
  const slug = deriveCategorySlug({ category: 'Trainer', name: 'Master Ball', aceSpec: true });
  assert.ok(slug.includes('acespec'));
});

test('deriveCategorySlug handles ace-spec from name inference', () => {
  const slug = deriveCategorySlug({ category: 'Trainer', name: 'Ace Spec card' });
  assert.ok(slug.includes('acespec'));
});

test('deriveCategorySlug returns pokemon for null', () => {
  assert.equal(deriveCategorySlug(null), 'pokemon');
});

test('deriveCategorySlug returns pokemon for empty card', () => {
  assert.equal(deriveCategorySlug({}), 'pokemon');
});

test('deriveCategorySlug handles stadium inference from name', () => {
  const slug = deriveCategorySlug({ name: 'Artazon Stadium' });
  assert.ok(slug.includes('stadium'));
});

test('deriveCategorySlug handles item inference from name', () => {
  const slug = deriveCategorySlug({ name: 'Ultra Ball' });
  assert.ok(slug.includes('item'));
});

test('deriveCategorySlug handles tool inference from name', () => {
  const slug = deriveCategorySlug({ name: 'Defiance Band' });
  assert.ok(slug.includes('tool'));
});

test('deriveCategorySlug handles technical machine', () => {
  const slug = deriveCategorySlug({ name: 'Technical Machine Devolution' });
  assert.ok(slug.includes('item'));
});

// ---------------------------------------------------------------------------
// getCategorySortWeight
// ---------------------------------------------------------------------------

test('getCategorySortWeight returns 999 for undefined', () => {
  assert.equal(getCategorySortWeight(undefined), 999);
});

test('getCategorySortWeight returns known weights', () => {
  assert.equal(getCategorySortWeight('pokemon'), 0);
  assert.equal(getCategorySortWeight('trainer/supporter'), 1);
  assert.equal(getCategorySortWeight('trainer/item'), 2);
  assert.equal(getCategorySortWeight('energy/basic'), 7);
  assert.equal(getCategorySortWeight('energy/special'), 8);
});

test('getCategorySortWeight uses prefix fallback for unknown pokemon variant', () => {
  assert.equal(getCategorySortWeight('pokemon/v'), 0);
});

test('getCategorySortWeight uses prefix fallback for unknown trainer variant', () => {
  assert.equal(getCategorySortWeight('trainer/unknown'), 6);
});

test('getCategorySortWeight uses prefix fallback for unknown energy variant', () => {
  assert.equal(getCategorySortWeight('energy/unknown'), 7);
});

test('getCategorySortWeight returns 999 for completely unknown category', () => {
  assert.equal(getCategorySortWeight('other'), 999);
});

// ---------------------------------------------------------------------------
// getUsagePercent
// ---------------------------------------------------------------------------

test('getUsagePercent returns 0 for null/undefined card', () => {
  assert.equal(getUsagePercent(null), 0);
  assert.equal(getUsagePercent(undefined), 0);
});

test('getUsagePercent returns pct when available', () => {
  assert.equal(getUsagePercent({ pct: 85.5 }), 85.5);
});

test('getUsagePercent computes from found/total', () => {
  const result = getUsagePercent({ found: 3, total: 4 });
  assert.equal(result, 75);
});

test('getUsagePercent returns 0 when total is 0', () => {
  assert.equal(getUsagePercent({ found: 3, total: 0 }), 0);
});

test('getUsagePercent returns 0 for missing found/total', () => {
  assert.equal(getUsagePercent({}), 0);
});

test('getUsagePercent prefers pct over found/total', () => {
  assert.equal(getUsagePercent({ pct: 50, found: 3, total: 4 }), 50);
});

// ---------------------------------------------------------------------------
// isAceSpec
// ---------------------------------------------------------------------------

test('isAceSpec returns true for known ace spec cards', () => {
  assert.equal(isAceSpec('Master Ball'), true);
  assert.equal(isAceSpec('Prime Catcher'), true);
  assert.equal(isAceSpec('Maximum Belt'), true);
  assert.equal(isAceSpec('Unfair Stamp'), true);
});

test('isAceSpec is case insensitive', () => {
  assert.equal(isAceSpec('MASTER BALL'), true);
  assert.equal(isAceSpec('master ball'), true);
});

test('isAceSpec returns false for non-ace spec cards', () => {
  assert.equal(isAceSpec('Pikachu'), false);
  assert.equal(isAceSpec('Ultra Ball'), false);
});

test('isAceSpec handles null/undefined', () => {
  assert.equal(isAceSpec(null), false);
  assert.equal(isAceSpec(undefined), false);
});
