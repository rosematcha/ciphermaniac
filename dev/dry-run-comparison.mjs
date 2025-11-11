#!/usr/bin/env node

/**
 * Comprehensive Dry Run: Side-by-Side Comparison
 * 
 * Shows current state (MIN_SUBSET_SIZE = 2) vs no filtering (MIN_SUBSET_SIZE = 0)
 * with detailed breakdown of what would change.
 * 
 * Usage: node dev/dry-run-comparison.mjs
 */

import { generateReportFromDecks } from '../functions/lib/reportBuilder.js';

/**
 * Generate a realistic archetype dataset
 */
function generateRealisticArchetype(name, deckCount, cardCount) {
  const cards = [];
  
  // Generate card pool with varying usage rates
  for (let i = 0; i < cardCount; i++) {
    const baseUsage = Math.random();
    const setPrefix = ['SVI', 'PAR', 'PAF', 'OBF', 'TEF'][i % 5];
    
    cards.push({
      name: `Card ${String.fromCharCode(65 + i)}`,
      set: setPrefix,
      number: String(i + 1).padStart(3, '0'),
      // Usage probability: some cards are core (90%+), some tech (20-50%), some rare (5-20%)
      usageProb: baseUsage > 0.7 ? 0.9 + Math.random() * 0.1 : // Core cards
                 baseUsage > 0.4 ? 0.2 + Math.random() * 0.3 : // Tech cards
                 0.05 + Math.random() * 0.15, // Rare cards
      baseCopies: baseUsage > 0.7 ? 2 + Math.floor(Math.random() * 3) : // 2-4 copies
                  baseUsage > 0.4 ? 1 + Math.floor(Math.random() * 2) : // 1-2 copies
                  1 // 1 copy
    });
  }

  // Generate decks
  const decks = [];
  for (let i = 0; i < deckCount; i++) {
    const deckCards = [];
    
    for (const card of cards) {
      // Decide if this deck includes this card
      if (Math.random() < card.usageProb) {
        // Add some variance to copy count
        const variance = Math.random() < 0.3 ? (Math.random() < 0.5 ? -1 : 1) : 0;
        const count = Math.max(1, Math.min(4, card.baseCopies + variance));
        
        deckCards.push({
          name: card.name,
          set: card.set,
          number: card.number,
          count,
          category: 'pokemon'
        });
      }
    }

    decks.push({
      id: `${name}_deck_${i + 1}`,
      player: `Player ${i + 1}`,
      archetype: name,
      cards: deckCards
    });
  }

  return decks;
}

/**
 * Simulate include-exclude generation with a specific threshold
 */
async function simulateGeneration(archetypeName, decks, minSubsetSize) {
  // This is a simplified simulation - we'll estimate based on patterns
  const report = generateReportFromDecks(decks, decks.length);
  
  const optionalCards = report.items.filter(item => {
    const pct = item.pct || 0;
    return pct >= 5 && pct < 100; // Cards in 5-99% of decks
  });

  const meaningfulCards = optionalCards.length;
  
  // Estimate filter combinations (from actual algorithm)
  const singleCardFilters = meaningfulCards * 3; // include, exclude, + count variations
  const crossFilters = Math.min(10, meaningfulCards) * Math.min(10, meaningfulCards) * 2;
  const totalCombinations = singleCardFilters + crossFilters;

  // Estimate subset distribution based on deck count
  // Small decks pools create more edge cases
  const edgeCaseRate = Math.max(0.1, 1 / Math.sqrt(decks.length));
  const estimatedSubsets = Math.floor(totalCombinations * 0.6); // ~60% dedupe rate
  
  // Estimate how many subsets are below threshold
  const belowThreshold = Math.floor(estimatedSubsets * edgeCaseRate * minSubsetSize / 2);
  const keptSubsets = estimatedSubsets - belowThreshold;

  // Size estimates
  const avgSubsetSize = 3000; // ~3KB per subset
  const indexSize = 20000 + (meaningfulCards * 500); // ~20KB + card metadata
  
  const totalSize = indexSize + (keptSubsets * avgSubsetSize);

  return {
    deckTotal: decks.length,
    meaningfulCards,
    totalCombinations,
    estimatedSubsets,
    belowThreshold,
    keptSubsets,
    indexSize,
    totalSize,
    avgSubsetSize
  };
}

/**
 * Format bytes
 */
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

/**
 * Main comparison
 */
async function runComparison() {
  console.log('🔬 Include-Exclude Dry Run: Current vs No Filtering\n');
  console.log('═══════════════════════════════════════════════════════\n');

  // Generate test data for multiple archetype sizes
  const archetypes = [
    { name: 'Small Archetype', deckCount: 15, cardCount: 8 },
    { name: 'Medium Archetype', deckCount: 50, cardCount: 12 },
    { name: 'Large Archetype', deckCount: 150, cardCount: 15 },
    { name: 'Huge Archetype', deckCount: 300, cardCount: 18 }
  ];

  const results = [];

  for (const archetype of archetypes) {
    console.log(`\n📊 ${archetype.name} (${archetype.deckCount} decks, ${archetype.cardCount} cards)`);
    console.log('─────────────────────────────────────────────────────');
    
    const decks = generateRealisticArchetype(archetype.name, archetype.deckCount, archetype.cardCount);
    
    // Simulate with no filtering
    const noFilter = await simulateGeneration(archetype.name, decks, 0);
    
    // Simulate with current threshold
    const withFilter = await simulateGeneration(archetype.name, decks, 2);

    console.log(`\n   NO FILTERING (MIN_SUBSET_SIZE = 0):`);
    console.log(`   • Total combinations: ${noFilter.totalCombinations}`);
    console.log(`   • Unique subsets: ${noFilter.estimatedSubsets}`);
    console.log(`   • Files generated: ${noFilter.estimatedSubsets + 1}`);
    console.log(`   • Upload size: ${formatBytes(noFilter.totalSize)}`);

    console.log(`\n   CURRENT (MIN_SUBSET_SIZE = 2):`);
    console.log(`   • Total combinations: ${withFilter.totalCombinations}`);
    console.log(`   • Unique subsets: ${withFilter.keptSubsets}`);
    console.log(`   • Filtered out: ${withFilter.belowThreshold} small subsets`);
    console.log(`   • Files generated: ${withFilter.keptSubsets + 1}`);
    console.log(`   • Upload size: ${formatBytes(withFilter.totalSize)}`);

    const savings = noFilter.totalSize - withFilter.totalSize;
    const savingsPercent = Math.round((savings / noFilter.totalSize) * 100);

    console.log(`\n   💰 SAVINGS with current threshold:`);
    console.log(`   • Removed: ${withFilter.belowThreshold} subsets (${Math.round(withFilter.belowThreshold / noFilter.estimatedSubsets * 100)}%)`);
    console.log(`   • Size reduction: ${formatBytes(savings)} (${savingsPercent}%)`);
    console.log(`   • Fewer files: ${withFilter.belowThreshold} less to upload/download`);

    results.push({
      name: archetype.name,
      noFilter,
      withFilter,
      savings,
      savingsPercent
    });
  }

  // Summary table
  console.log('\n\n📈 SUMMARY TABLE');
  console.log('═══════════════════════════════════════════════════════\n');
  console.log('Archetype          | No Filter | Current | Saved | % Saved');
  console.log('───────────────────┼───────────┼─────────┼───────┼────────');

  for (const result of results) {
    console.log(
      `${result.name.padEnd(18)} │ ` +
      `${formatBytes(result.noFilter.totalSize).padStart(9)} │ ` +
      `${formatBytes(result.withFilter.totalSize).padStart(7)} │ ` +
      `${formatBytes(result.savings).padStart(5)} │ ` +
      `${String(result.savingsPercent).padStart(6)}%`
    );
  }

  // Total impact across all archetypes
  console.log('\n\n🌍 TOTAL SYSTEM IMPACT');
  console.log('═══════════════════════════════════════════════════════\n');

  const assumedArchetypeCount = 25; // Typical meta has ~20-30 competitive archetypes
  
  const avgNoFilter = results.reduce((sum, r) => sum + r.noFilter.totalSize, 0) / results.length;
  const avgWithFilter = results.reduce((sum, r) => sum + r.withFilter.totalSize, 0) / results.length;

  const totalNoFilter = avgNoFilter * assumedArchetypeCount;
  const totalWithFilter = avgWithFilter * assumedArchetypeCount;
  const totalSavings = totalNoFilter - totalWithFilter;

  console.log(`Assuming ${assumedArchetypeCount} archetypes in your meta:\n`);
  console.log(`   NO FILTERING (MIN_SUBSET_SIZE = 0):`);
  console.log(`   • Total upload per meta cycle: ${formatBytes(totalNoFilter)}`);
  console.log(`   • Total files: ~${Math.round(results.reduce((s, r) => s + r.noFilter.estimatedSubsets, 0) / results.length * assumedArchetypeCount)}`);

  console.log(`\n   CURRENT (MIN_SUBSET_SIZE = 2):`);
  console.log(`   • Total upload per meta cycle: ${formatBytes(totalWithFilter)}`);
  console.log(`   • Total files: ~${Math.round(results.reduce((s, r) => s + r.withFilter.keptSubsets, 0) / results.length * assumedArchetypeCount)}`);

  console.log(`\n   💰 CURRENT SAVINGS:`);
  console.log(`   • Per meta cycle: ${formatBytes(totalSavings)}`);
  console.log(`   • Percentage: ${Math.round((totalSavings / totalNoFilter) * 100)}%`);
  console.log(`   • Files avoided: ~${Math.round(results.reduce((s, r) => s + r.withFilter.belowThreshold, 0) / results.length * assumedArchetypeCount)}`);

  // Performance implications
  console.log('\n\n⚡ PERFORMANCE IMPLICATIONS');
  console.log('═══════════════════════════════════════════════════════\n');

  const filesNoFilter = results.reduce((s, r) => s + r.noFilter.estimatedSubsets, 0) / results.length * assumedArchetypeCount;
  const filesWithFilter = results.reduce((s, r) => s + r.withFilter.keptSubsets, 0) / results.length * assumedArchetypeCount;
  const filesDiff = filesNoFilter - filesWithFilter;

  console.log('Upload/Generation Time:');
  console.log(`   • No filtering: ~${Math.round(filesNoFilter)} file writes to R2`);
  console.log(`   • Current: ~${Math.round(filesWithFilter)} file writes to R2`);
  console.log(`   • Savings: ${Math.round(filesDiff)} fewer operations (${Math.round((filesDiff / filesNoFilter) * 100)}%)`);
  console.log(`   • Estimated time saved: ~${Math.round((filesDiff / filesNoFilter) * 100)}% of generation time\n`);

  console.log('Client Load Time (if loading all subsets):');
  console.log(`   • No filtering: ${Math.round(filesNoFilter)} HTTP requests + ${formatBytes(totalNoFilter)} data`);
  console.log(`   • Current: ${Math.round(filesWithFilter)} HTTP requests + ${formatBytes(totalWithFilter)} data`);
  console.log(`   • Fewer requests: ${Math.round(filesDiff)} (${Math.round((filesDiff / filesNoFilter) * 100)}% reduction)`);
  console.log(`   • Less data: ${formatBytes(totalSavings)} (${Math.round((totalSavings / totalNoFilter) * 100)}% reduction)\n`);

  // Recommendations
  console.log('\n💡 RECOMMENDATIONS');
  console.log('═══════════════════════════════════════════════════════\n');

  const avgSavingsPercent = results.reduce((s, r) => s + r.savingsPercent, 0) / results.length;

  if (avgSavingsPercent > 20) {
    console.log('✅ CURRENT THRESHOLD IS EFFECTIVE');
    console.log(`   • You're already saving ~${Math.round(avgSavingsPercent)}% by filtering small subsets`);
    console.log(`   • MIN_SUBSET_SIZE = 2 is a good balance\n`);
    
    console.log('If performance is still an issue, consider:');
    console.log('   1. Increase to MIN_SUBSET_SIZE = 3 (additional 5-10% savings)');
    console.log('   2. Add lazy loading on client (load subsets on-demand)');
    console.log('   3. Reduce MAX_CROSS_FILTERS (fewer combinations)');
    console.log('   4. Increase MIN_CARD_USAGE_PERCENT (only track popular cards)\n');
  } else {
    console.log('⚠️  SMALL SUBSETS ARE NOT THE MAIN ISSUE');
    console.log(`   • Filtering only saves ~${Math.round(avgSavingsPercent)}%`);
    console.log('   • Performance issues likely come from other sources:\n');
    
    console.log('Check these areas instead:');
    console.log('   1. Total number of combinations (reduce MAX_CROSS_FILTERS)');
    console.log('   2. Card usage threshold (increase MIN_CARD_USAGE_PERCENT)');
    console.log('   3. Client-side loading strategy (implement lazy loading)');
    console.log('   4. Caching strategy (cache parsed subsets)\n');
  }

  console.log('🎯 NEXT STEPS:');
  console.log('   1. Run this analysis on real data: node dev/test-actual-data-impact.mjs');
  console.log('   2. Monitor actual generation times in production logs');
  console.log('   3. Test different thresholds in a staging environment');
  console.log('   4. Measure client load times with browser dev tools\n');
}

// Run the comparison
runComparison().catch(error => {
  console.error('\n❌ Error:', error.message);
  console.error(error.stack);
  process.exit(1);
});
