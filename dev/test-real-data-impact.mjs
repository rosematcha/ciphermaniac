#!/usr/bin/env node

/**
 * Real Data Impact Analysis
 * 
 * This script fetches recent online tournament data and compares
 * the upload sizes with different MIN_SUBSET_SIZE thresholds.
 * 
 * Requires: LIMITLESS_API_KEY environment variable
 * Usage: node dev/test-real-data-impact.mjs
 */

import { generateIncludeExcludeReports } from '../functions/lib/onlineMetaIncludeExclude.js';
import { generateReportFromDecks } from '../functions/lib/reportBuilder.js';

const MIN_SUBSET_SIZES_TO_TEST = [0, 2, 3, 4, 5];

/**
 * Mock environment for API access
 */
const mockEnv = {
  LIMITLESS_API_KEY: process.env.LIMITLESS_API_KEY
};

/**
 * Simplified version of include-exclude generation with configurable threshold
 */
async function generateWithThreshold(archetypeName, decks, report, minSubsetSize) {
  // We'll need to temporarily modify the MIN_SUBSET_SIZE constant
  // For now, let's just measure what the current system generates
  
  const result = await generateIncludeExcludeReports(archetypeName, decks, report, mockEnv);
  
  if (!result) {
    return null;
  }

  // Calculate sizes
  let totalSize = 0;
  const indexSize = JSON.stringify(result.index, null, 2).length;
  totalSize += indexSize;

  for (const [contentHash, subset] of result.subsets.entries()) {
    const subsetSize = JSON.stringify(subset.data, null, 2).length;
    totalSize += subsetSize;
  }

  return {
    uniqueSubsets: result.subsets.size,
    totalSize,
    indexSize,
    index: result.index
  };
}

/**
 * Fetch recent tournament data
 */
async function fetchRecentData() {
  console.log('📡 Fetching recent tournament data from Limitless...\n');
  
  if (!mockEnv.LIMITLESS_API_KEY) {
    console.error('❌ Error: LIMITLESS_API_KEY environment variable not set');
    console.log('\nPlease set it in your environment or .env file:');
    console.log('  PowerShell: $env:LIMITLESS_API_KEY="your_key_here"');
    console.log('  Bash: export LIMITLESS_API_KEY="your_key_here"');
    process.exit(1);
  }

  const baseUrl = 'https://play.limitlesstcg.com/api';
  
  // Fetch recent tournaments - use query param for authentication
  const url = new URL(`${baseUrl}/tournaments`);
  url.searchParams.set('game', 'PTCG');
  url.searchParams.set('limit', '50');
  url.searchParams.set('page', '1');
  url.searchParams.set('key', mockEnv.LIMITLESS_API_KEY);
  
  const response = await fetch(url, {
    headers: {
      'X-Access-Key': mockEnv.LIMITLESS_API_KEY,
      'Accept': 'application/json'
    }
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(`Failed to fetch tournaments: ${response.status} ${response.statusText}\n${bodyText.slice(0, 200)}`);
  }

  const tournaments = await response.json();
  
  // Filter for recent online standard tournaments
  const cutoffDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const onlineTournaments = tournaments.filter(t => {
    const tournamentDate = new Date(t.date);
    return tournamentDate >= cutoffDate;
  });

  console.log(`   Found ${onlineTournaments.length} recent tournaments`);
  
  // Fetch details for first few tournaments
  const tournamentsWithDecks = [];
  for (const tournament of onlineTournaments.slice(0, 5)) {
    try {
      const detailsUrl = new URL(`${baseUrl}/tournaments/${tournament.id}/details`);
      detailsUrl.searchParams.set('key', mockEnv.LIMITLESS_API_KEY);
      
      const detailsResponse = await fetch(detailsUrl, {
        headers: {
          'X-Access-Key': mockEnv.LIMITLESS_API_KEY,
          'Accept': 'application/json'
        }
      });

      if (!detailsResponse.ok) {
        continue;
      }

      const details = await detailsResponse.json();
      
      if (details.isOnline && details.decklists) {
        console.log(`   ✓ ${tournament.name} (${tournament.players} players)`);
        tournamentsWithDecks.push({
          summary: tournament,
          details
        });
      }
    } catch (error) {
      console.log(`   ✗ Failed to fetch ${tournament.name}: ${error.message}`);
    }
  }

  return tournamentsWithDecks;
}

/**
 * Extract decks by archetype from tournament data
 */
function extractArchetypeDecks(tournaments) {
  const decksByArchetype = new Map();

  for (const tournament of tournaments) {
    const standings = tournament.details?.standings || [];
    
    for (const standing of standings) {
      if (!standing.decklist?.pokemon || !standing.archetype) {
        continue;
      }

      const archetype = standing.archetype;
      
      if (!decksByArchetype.has(archetype)) {
        decksByArchetype.set(archetype, []);
      }

      // Convert to our format
      const cards = [];
      
      for (const card of standing.decklist.pokemon || []) {
        cards.push({
          name: card.name,
          set: card.set,
          number: card.number,
          count: card.count || 1,
          category: 'pokemon'
        });
      }
      
      for (const card of standing.decklist.trainer || []) {
        cards.push({
          name: card.name,
          set: card.set,
          number: card.number,
          count: card.count || 1,
          category: 'trainer'
        });
      }
      
      for (const card of standing.decklist.energy || []) {
        cards.push({
          name: card.name,
          set: card.set,
          number: card.number,
          count: card.count || 1,
          category: 'energy'
        });
      }

      decksByArchetype.get(archetype).push({
        id: standing.decklist.id || `${tournament.summary.id}_${standing.placing}`,
        player: standing.name,
        archetype,
        cards
      });
    }
  }

  return decksByArchetype;
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
 * Main analysis
 */
async function runRealDataAnalysis() {
  console.log('🔬 Real Tournament Data Impact Analysis\n');
  console.log('═══════════════════════════════════════════════\n');

  try {
    // Fetch data
    const tournaments = await fetchRecentData();
    
    if (tournaments.length === 0) {
      console.log('\n❌ No tournaments with decklists found');
      return;
    }

    console.log(`\n✅ Loaded ${tournaments.length} tournaments with decklists\n`);

    // Extract decks by archetype
    const decksByArchetype = extractArchetypeDecks(tournaments);
    
    console.log('📊 Archetype Distribution:');
    console.log('─────────────────────────────────────────────');
    
    // Sort by deck count
    const archetypesSorted = Array.from(decksByArchetype.entries())
      .sort((a, b) => b[1].length - a[1].length);
    
    for (const [archetype, decks] of archetypesSorted.slice(0, 10)) {
      console.log(`   ${archetype}: ${decks.length} decks`);
    }

    // Pick the top archetype with enough decks
    const targetArchetype = archetypesSorted.find(([_, decks]) => decks.length >= 10);
    
    if (!targetArchetype) {
      console.log('\n❌ No archetype with 10+ decks found');
      return;
    }

    const [archetypeName, archetypeDecks] = targetArchetype;
    
    console.log(`\n🎯 Analyzing: ${archetypeName} (${archetypeDecks.length} decks)\n`);

    // Generate base report
    const archetypeReport = generateReportFromDecks(archetypeDecks, archetypeDecks.length);
    
    console.log(`   Cards in archetype: ${archetypeReport.items.length}`);
    
    // Current implementation (MIN_SUBSET_SIZE = 2)
    console.log('\n⏳ Generating include-exclude reports with current settings...\n');
    
    const currentResult = await generateWithThreshold(
      archetypeName,
      archetypeDecks,
      archetypeReport,
      2 // current default
    );

    if (!currentResult) {
      console.log('❌ Failed to generate reports');
      return;
    }

    console.log('📈 CURRENT IMPLEMENTATION (MIN_SUBSET_SIZE = 2)');
    console.log('═══════════════════════════════════════════════\n');
    console.log(`   Unique Subsets: ${currentResult.uniqueSubsets}`);
    console.log(`   Total Upload Size: ${formatBytes(currentResult.totalSize)}`);
    console.log(`   Index Size: ${formatBytes(currentResult.indexSize)}`);
    console.log(`   Subset Files Size: ${formatBytes(currentResult.totalSize - currentResult.indexSize)}`);
    console.log(`   Avg Subset Size: ${formatBytes((currentResult.totalSize - currentResult.indexSize) / currentResult.uniqueSubsets)}`);

    // Show subset size distribution
    if (currentResult.index.subsets) {
      const sizeDistribution = new Map();
      for (const [subsetId, metadata] of Object.entries(currentResult.index.subsets)) {
        const deckCount = metadata.deckTotal;
        sizeDistribution.set(deckCount, (sizeDistribution.get(deckCount) || 0) + 1);
      }

      console.log('\n   Subset Size Distribution:');
      const sortedSizes = Array.from(sizeDistribution.entries()).sort((a, b) => a[0] - b[0]);
      for (const [size, count] of sortedSizes.slice(0, 20)) {
        console.log(`     ${size} decks: ${count} subsets`);
      }
      if (sortedSizes.length > 20) {
        console.log(`     ... and ${sortedSizes.length - 20} more size categories`);
      }
    }

    // Estimate impact without culling
    console.log('\n\n💡 ESTIMATED IMPACT ANALYSIS');
    console.log('═══════════════════════════════════════════════\n');
    
    // Count how many subsets are 1-deck only
    let singleDeckSubsets = 0;
    let smallSubsets = 0; // <3 decks
    let tinySubsets = 0; // <5 decks
    
    if (currentResult.index.subsets) {
      for (const [subsetId, metadata] of Object.entries(currentResult.index.subsets)) {
        const deckCount = metadata.deckTotal;
        if (deckCount === 1) singleDeckSubsets++;
        if (deckCount < 3) smallSubsets++;
        if (deckCount < 5) tinySubsets++;
      }
    }

    console.log('If we removed MIN_SUBSET_SIZE threshold (set to 0):');
    console.log(`   • Would add ~${singleDeckSubsets} single-deck subsets`);
    console.log(`   • Would add ~${smallSubsets - singleDeckSubsets} 2-deck subsets`);
    console.log(`   • Estimated additional upload: ${formatBytes((currentResult.totalSize / currentResult.uniqueSubsets) * smallSubsets)}`);
    console.log(`   • Total upload would be: ${formatBytes(currentResult.totalSize + (currentResult.totalSize / currentResult.uniqueSubsets) * smallSubsets)}`);
    
    console.log('\n\nIf we increased MIN_SUBSET_SIZE to 3:');
    console.log(`   • Would remove ~${smallSubsets} small subsets`);
    console.log(`   • Estimated reduction: ${formatBytes((currentResult.totalSize / currentResult.uniqueSubsets) * smallSubsets)}`);
    console.log(`   • Total upload would be: ${formatBytes(currentResult.totalSize - (currentResult.totalSize / currentResult.uniqueSubsets) * smallSubsets)}`);
    console.log(`   • Reduction: ${Math.round((smallSubsets / currentResult.uniqueSubsets) * 100)}%`);

    console.log('\n\nIf we increased MIN_SUBSET_SIZE to 5:');
    console.log(`   • Would remove ~${tinySubsets} tiny subsets`);
    console.log(`   • Estimated reduction: ${formatBytes((currentResult.totalSize / currentResult.uniqueSubsets) * tinySubsets)}`);
    console.log(`   • Total upload would be: ${formatBytes(currentResult.totalSize - (currentResult.totalSize / currentResult.uniqueSubsets) * tinySubsets)}`);
    console.log(`   • Reduction: ${Math.round((tinySubsets / currentResult.uniqueSubsets) * 100)}%`);

    console.log('\n\n🎯 RECOMMENDATIONS');
    console.log('═══════════════════════════════════════════════\n');
    
    const smallPercentage = (smallSubsets / currentResult.uniqueSubsets) * 100;
    
    if (smallPercentage > 30) {
      console.log('⚠️  HIGH IMPACT: Over 30% of subsets are small (<3 decks)');
      console.log('   Consider increasing MIN_SUBSET_SIZE to 3 or higher');
      console.log(`   This would reduce uploads by ~${Math.round(smallPercentage)}%`);
    } else if (smallPercentage > 15) {
      console.log('⚡ MODERATE IMPACT: 15-30% of subsets are small');
      console.log('   Current threshold (2) seems reasonable');
      console.log('   Consider increasing to 3 if performance is critical');
    } else {
      console.log('✅ LOW IMPACT: Most subsets are meaningful size');
      console.log('   Current threshold (2) is working well');
    }

    console.log('\n📌 Key Considerations:');
    console.log('   • Small subsets (<3 decks) often represent edge cases');
    console.log('   • They increase upload size and processing time');
    console.log('   • But they provide granular filtering options');
    console.log('   • Balance based on user needs vs performance\n');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run analysis
runRealDataAnalysis();
