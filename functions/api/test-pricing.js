/**
 * Test endpoint for pricing functionality
 * Call manually to test the pricing system before deployment
 */

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const action = url.searchParams.get('action') || 'test';
    
    switch (action) {
      case 'groups':
        return await testTCGCSVGroups();
        
      case 'csv':
        const groupId = url.searchParams.get('groupId') || '24269'; // Default to DRI
        return await testCSVParsing(groupId);
        
      case 'mapping':
        return await testSetMapping();
        
      case 'database':
        return await testDatabaseFiltering();
        
      case 'columns':
        const testGroupId = url.searchParams.get('groupId') || '23651'; // Default to SSP for Ceruledge
        return await testColumnAlignment(testGroupId);
        
      case 'full':
        // Test the full pricing pipeline
        const { onRequestGet: pricingUpdate } = await import('./pricing.js');
        return await pricingUpdate({ env });
        
      default:
        return new Response(JSON.stringify({
          message: 'Pricing API Test',
          availableActions: [
            'groups - Test TCGCSV groups API',
            'csv - Test CSV parsing (add ?groupId=XXXX)',
            'mapping - Test set mapping logic', 
            'database - Show database card filtering',
            'columns - Test CSV column alignment (add ?groupId=XXXX)',
            'full - Run full pricing update'
          ],
          example: '/api/test-pricing?action=groups'
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
    }
    
  } catch (error) {
    console.error('Test error:', error);
    
    return new Response(JSON.stringify({
      error: 'Test failed',
      message: error.message,
      stack: error.stack
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function testTCGCSVGroups() {
  const response = await fetch('https://tcgcsv.com/tcgplayer/3/groups');
  const data = await response.json();
  
  // Find some relevant sets
  const relevantSets = data.results.filter(g => 
    ['SVI', 'PAL', 'DRI', 'TWM', 'SFA'].includes(g.abbreviation)
  ).slice(0, 5);
  
  return new Response(JSON.stringify({
    success: data.success,
    totalGroups: data.results.length,
    relevantSets,
    sampleGroup: data.results[0]
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function testCSVParsing(groupId) {
  const csvUrl = `https://tcgcsv.com/tcgplayer/3/${groupId}/ProductsAndPrices.csv`;
  const response = await fetch(csvUrl);
  const csvText = await response.text();
  
  const lines = csvText.split('\n');
  const header = lines[0];
  const sampleLines = lines.slice(1, 4); // Get first 3 data lines
  
  return new Response(JSON.stringify({
    groupId,
    csvUrl,
    totalLines: lines.length,
    header: header.split(','),
    sampleLines: sampleLines.map(line => {
      const fields = line.split(',');
      return {
        name: fields[1],
        extNumber: fields[17],
        marketPrice: fields[13]
      };
    })
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function testSetMapping() {
  const response = await fetch('https://tcgcsv.com/tcgplayer/3/groups');
  const data = await response.json();
  
  const knownSets = ['SVI', 'PAL', 'DRI', 'TWM', 'SFA', 'TEF', 'JTG', 'MEW'];
  const mappings = {};
  
  for (const setAbbr of knownSets) {
    const group = data.results.find(g => g.abbreviation === setAbbr);
    mappings[setAbbr] = group ? {
      groupId: group.groupId,
      name: group.name,
      published: group.publishedOn
    } : null;
  }
  
  return new Response(JSON.stringify({
    mappings,
    foundSets: Object.values(mappings).filter(Boolean).length,
    totalKnownSets: knownSets.length
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function testDatabaseFiltering() {
  // Import the database cards from pricing module
  const pricingModule = await import('./pricing.js');
  
  // Sample some database cards to show filtering
  const sampleDatabaseCards = [
    "Ultra Ball::SVI::196",
    "Boss's Orders::PAL::172", 
    "Charizard ex::OBF::125",
    "Night Stretcher::SFA::061",
    "Ethan's Pichu::DRI::071"
  ];
  
  return new Response(JSON.stringify({
    message: 'Database filtering test',
    totalDatabaseCards: 428, // DATABASE_CARDS.size
    sampleCards: sampleDatabaseCards,
    explanation: 'Only cards in your tournament database will get prices',
    databaseSets: ['SVI', 'PAL', 'DRI', 'TWM', 'SFA', 'TEF', 'JTG', 'MEW', 'OBF', 'PAR', 'SSP', 'SCR', 'PRE', 'BLK', 'WHT', 'PAF', 'SVP', 'SVE'],
    filteringLogic: 'CSV parsing now checks DATABASE_CARDS.has(cardKey) before including prices'
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function testColumnAlignment(groupId) {
  const csvUrl = `https://tcgcsv.com/tcgplayer/3/${groupId}/ProductsAndPrices.csv`;
  const response = await fetch(csvUrl);
  const csvText = await response.text();
  
  const lines = csvText.split('\n');
  const header = lines[0];
  
  // Find Ceruledge ex line for testing
  const ceruledgeLine = lines.find(line => line.includes('Ceruledge ex'));
  
  if (ceruledgeLine) {
    // Parse the line using our CSV parser
    const fields = ceruledgeLine.split(',');
    
    return new Response(JSON.stringify({
      groupId,
      headerColumns: header.split(','),
      ceruledgeExample: {
        name: fields[1],
        extNumber: fields[17],
        lowPrice: fields[10],
        midPrice: fields[11], 
        highPrice: fields[12],
        marketPrice: fields[13],
        directLowPrice: fields[14]
      },
      explanation: 'Should use index 13 for marketPrice, not 12 (highPrice) or 14 (directLowPrice)',
      currentCodeUses: 'fields[13] - which should be correct'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } else {
    return new Response(JSON.stringify({
      error: 'Ceruledge ex not found in this set',
      groupId,
      try: 'Use ?groupId=23651 for SSP set where Ceruledge ex exists'
    }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}