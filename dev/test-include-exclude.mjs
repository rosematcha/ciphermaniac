#!/usr/bin/env node

/**
 * Test script for include-exclude report generation
 * Tests the new card count filtering functionality
 */

import { generateIncludeExcludeReports } from '../functions/lib/onlineMetaIncludeExclude.js';

// Mock environment (not needed for report generation logic, only for writing to R2)
const mockEnv = {};

// Sample archetype data (mimicking online meta structure)
const sampleArchetypeDecks = [
  {
    id: 'deck1',
    player: 'Player 1',
    archetype: 'Gardevoir',
    cards: [
      { name: 'Gardevoir ex', set: 'SVI', number: '86', count: 2, category: 'pokemon' },
      { name: 'Kirlia', set: 'SVI', number: '68', count: 2, category: 'pokemon' },
      { name: 'Ralts', set: 'SVI', number: '84', count: 4, category: 'pokemon' },
      { name: 'Jellicent', set: 'PAR', number: '42', count: 1, category: 'pokemon' },
      { name: 'Ultra Ball', set: 'SVI', number: '196', count: 4, category: 'trainer' }
    ]
  },
  {
    id: 'deck2',
    player: 'Player 2',
    archetype: 'Gardevoir',
    cards: [
      { name: 'Gardevoir ex', set: 'SVI', number: '86', count: 2, category: 'pokemon' },
      { name: 'Kirlia', set: 'SVI', number: '68', count: 3, category: 'pokemon' },
      { name: 'Ralts', set: 'SVI', number: '84', count: 4, category: 'pokemon' },
      { name: 'Iron Valiant', set: 'PAF', number: '88', count: 1, category: 'pokemon' },
      { name: 'Ultra Ball', set: 'SVI', number: '196', count: 4, category: 'trainer' }
    ]
  },
  {
    id: 'deck3',
    player: 'Player 3',
    archetype: 'Gardevoir',
    cards: [
      { name: 'Gardevoir ex', set: 'SVI', number: '86', count: 2, category: 'pokemon' },
      { name: 'Kirlia', set: 'SVI', number: '68', count: 1, category: 'pokemon' },
      { name: 'Ralts', set: 'SVI', number: '84', count: 4, category: 'pokemon' },
      { name: 'Jellicent', set: 'PAR', number: '42', count: 1, category: 'pokemon' },
      { name: 'Iron Valiant', set: 'PAF', number: '88', count: 1, category: 'pokemon' },
      { name: 'Ultra Ball', set: 'SVI', number: '196', count: 4, category: 'trainer' }
    ]
  },
  {
    id: 'deck4',
    player: 'Player 4',
    archetype: 'Gardevoir',
    cards: [
      { name: 'Gardevoir ex', set: 'SVI', number: '86', count: 2, category: 'pokemon' },
      { name: 'Kirlia', set: 'SVI', number: '68', count: 2, category: 'pokemon' },
      { name: 'Ralts', set: 'SVI', number: '84', count: 4, category: 'pokemon' },
      { name: 'Ultra Ball', set: 'SVI', number: '196', count: 4, category: 'trainer' }
    ]
  },
  {
    id: 'deck5',
    player: 'Player 5',
    archetype: 'Gardevoir',
    cards: [
      { name: 'Gardevoir ex', set: 'SVI', number: '86', count: 2, category: 'pokemon' },
      { name: 'Kirlia', set: 'SVI', number: '68', count: 3, category: 'pokemon' },
      { name: 'Ralts', set: 'SVI', number: '84', count: 4, category: 'pokemon' },
      { name: 'Jellicent', set: 'PAR', number: '42', count: 2, category: 'pokemon' },
      { name: 'Ultra Ball', set: 'SVI', number: '196', count: 4, category: 'trainer' }
    ]
  }
];

// Mock archetype report (simplified)
const sampleArchetypeReport = {
  deckTotal: 5,
  items: [
    { rank: 1, name: 'Gardevoir ex', set: 'SVI', number: '086', found: 5, total: 5, pct: 100, dist: [{ copies: 2, players: 5, percent: 100 }] },
    { rank: 2, name: 'Ralts', set: 'SVI', number: '084', found: 5, total: 5, pct: 100, dist: [{ copies: 4, players: 5, percent: 100 }] },
    { rank: 3, name: 'Ultra Ball', set: 'SVI', number: '196', found: 5, total: 5, pct: 100, dist: [{ copies: 4, players: 5, percent: 100 }] },
    { rank: 4, name: 'Kirlia', set: 'SVI', number: '068', found: 5, total: 5, pct: 100, dist: [
      { copies: 1, players: 1, percent: 20 },
      { copies: 2, players: 2, percent: 40 },
      { copies: 3, players: 2, percent: 40 }
    ]},
    { rank: 5, name: 'Jellicent', set: 'PAR', number: '042', found: 3, total: 5, pct: 60, dist: [
      { copies: 1, players: 2, percent: 66.67 },
      { copies: 2, players: 1, percent: 33.33 }
    ]},
    { rank: 6, name: 'Iron Valiant', set: 'PAF', number: '088', found: 2, total: 5, pct: 40, dist: [{ copies: 1, players: 2, percent: 100 }] }
  ]
};

async function testIncludeExclude() {
  console.log('Testing include-exclude report generation...\n');

  try {
    const reports = await generateIncludeExcludeReports(
      'Gardevoir',
      sampleArchetypeDecks,
      sampleArchetypeReport,
      mockEnv
    );

    if (!reports) {
      console.error('❌ No reports generated');
      return;
    }

    console.log('✅ Reports generated successfully!\n');
    console.log('Index summary:');
    console.log(`  - Archetype: ${reports.index.archetype}`);
    console.log(`  - Deck total: ${reports.index.deckTotal}`);
    console.log(`  - Total combinations: ${reports.index.totalCombinations}`);
    console.log(`  - Unique subsets: ${reports.index.uniqueSubsets}`);
    console.log(`  - Deduplication rate: ${reports.index.deduplicationRate}%`);
    console.log(`  - Optional cards: ${Object.keys(reports.index.cards).filter(id => !reports.index.cards[id].alwaysIncluded).length}`);

    console.log('\nSample filter combinations:');
    const filterKeys = Object.keys(reports.index.filterMap).slice(0, 10);
    for (const filterKey of filterKeys) {
      const subsetId = reports.index.filterMap[filterKey];
      console.log(`  - ${filterKey} -> ${subsetId}`);
    }

    console.log('\nCount-based filters for Kirlia:');
    const kirliaId = 'SVI~068';
    const kirliaCard = reports.index.cards[kirliaId];
    if (kirliaCard) {
      console.log(`  - Kirlia found in ${kirliaCard.found}/${kirliaCard.total} decks (${kirliaCard.pct}%)`);
      console.log(`  - Distribution: ${JSON.stringify(kirliaCard.dist)}`);
      
      // Find filters that apply to Kirlia with count conditions
      const kirliaFilters = Object.keys(reports.index.filterMap).filter(key => {
        return key.includes('SVI~068') && (key.includes('>=') || key.includes('='));
      });
      console.log(`  - Count-based filters: ${kirliaFilters.length}`);
      kirliaFilters.slice(0, 5).forEach(f => console.log(`    • ${f}`));
    }

    console.log('\n✅ Test completed successfully!');
  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

testIncludeExclude();
