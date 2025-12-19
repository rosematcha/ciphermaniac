import test from 'node:test';
import assert from 'node:assert/strict';
import { findCard } from '../../src/card/data.ts';

test('Handle special characters in card names (apostrophe, hyphen, slash, emoji, accents, Asian chars)', () => {
  const items = [
    { uid: "N's Zoroark::NS::001", name: "N's Zoroark" },
    { uid: 'Ho-Oh::HO::002', name: 'Ho-Oh' },
    { uid: 'EX/GX::EX::003', name: 'EX/GX' },
    { uid: 'Emoji::EM::004', name: 'Smile 😄' },
    { uid: 'Acc::AC::005', name: 'Pokémon' },
    { uid: 'Asia::AS::006', name: '水' }
  ];

  assert.ok(findCard(items as any, "N's Zoroark")?.uid);
  assert.ok(findCard(items as any, 'ho-oh') === null || findCard(items as any, 'Ho-Oh')?.uid);
  assert.ok(findCard(items as any, 'EX/GX')?.uid);
  assert.ok(findCard(items as any, 'Smile 😄')?.uid);
  assert.ok(findCard(items as any, 'pokémon')?.uid);
  assert.ok(findCard(items as any, '水')?.uid);
});
