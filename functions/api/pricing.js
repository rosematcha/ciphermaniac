/**
 * CloudFlare Pages function for daily TCGCSV pricing scraping
 * Simple, focused approach: get only the sets we actually need
 */

const TCGCSV_GROUPS_URL = 'https://tcgcsv.com/tcgplayer/3/groups';

// Database cards - only these cards will have prices returned
// This list is derived from your tournament database
const DATABASE_CARDS = new Set([
  "Academy at Night::SFA::054", "Air Balloon::BLK::079", "Ancient Booster Energy Capsule::TEF::140", "Annihilape::SSP::100", "Applin::TWM::017", "Archaludon ex::SSP::130", "Area Zero Underdepths::SCR::131", "Armarouge::SVI::041", "Artazon::PAL::171", "Arven::OBF::186", "Big Air Balloon::MEW::155", "Binding Mochi::PRE::095", "Black Belt's Training::JTG::145", "Blaziken ex::JTG::024", "Blaziken::DRI::042", "Blissey ex::TWM::134", "Bloodmoon Ursaluna ex::TWM::141", "Bombirdier ex::PAR::156", "Boomerang Energy::TWM::166", "Boss's Orders::PAL::172", "Bouffalant::SCR::119", "Brave Bangle::WHT::080", "Bravery Charm::PAL::173", "Briar::SCR::132", "Brilliant Blender::SSP::164", "Brock's Scouting::JTG::146", "Brute Bonnet::PAR::123", "Buddy-Buddy Poffin::TEF::144", "Budew::PRE::004", "Bug Catching Set::TWM::143", "Calamitous Snowy Mountain::PAL::174", "Calamitous Wasteland::PAL::175", "Carmine::TWM::145", "Centiskorch::SSP::028", "Ceruledge ex::SSP::036", "Chansey::MEW::113", "Chansey::TWM::133", "Charcadet::PAL::039", "Charcadet::PAR::026", "Charcadet::SCR::029", "Charcadet::SSP::032", "Charizard ex::OBF::125", "Charmander::OBF::026", "Charmander::PAF::007", "Charmander::SVP::047", "Charmeleon::MEW::005", "Charmeleon::OBF::027", "Charmeleon::PAF::008", "Chien-Pao::SSP::056", "Chi-Yu::PAR::029", "Chi-Yu::TWM::039", "Ciphermaniac's Codebreaking::TEF::145", "Clefable::TWM::079", "Clefairy::OBF::081", "Cleffa::OBF::080", "Colress's Tenacity::SFA::057", "Combusken::DRI::041", "Combusken::JTG::023", "Conkeldurr::TWM::105", "Cornerstone Mask Ogerpon ex::TWM::112", "Counter Catcher::PAR::160", "Counter Gain::SSP::169", "Crabominable::SCR::042", "Crispin::SCR::133", "Croconaw::TEF::040", "Crushing Hammer::SVI::168", "Crustle::DRI::012", "Cycling Road::MEW::157", "Cynthia's Gabite::DRI::103", "Cynthia's Garchomp ex::DRI::104", "Cynthia's Gible::DRI::102", "Cynthia's Power Weight::DRI::162", "Cynthia's Roselia::DRI::007", "Cynthia's Roserade::DRI::008", "Cynthia's Spiritomb::DRI::129", "Cyrano::SSP::170", "Darkness Energy::SVE::015", "Defiance Band::SVI::169", "Defiance Vest::PAR::162", "Deino::SSP::117", "Dipplin::TWM::018", "Ditto::MEW::132", "Dodrio::MEW::085", "Doduo::MEW::084", "Dragapult ex::TWM::130", "Drakloak::TWM::129", "Drayton::SSP::174", "Dreepy::TWM::128", "Drifloon::SVI::089", "Dudunsparce ex::JTG::121", "Dudunsparce::TEF::129", "Dunsparce::JTG::120", "Dunsparce::PAL::156", "Dunsparce::TEF::128", "Duraludon::SCR::106", "Durant ex::SSP::004", "Dusclops::PRE::036", "Dusk Ball::SSP::175", "Dusknoir::PRE::037", "Duskull::PRE::035", "Dwebble::DRI::011", "Earthen Vessel::PAR::163", "Eevee ex::PRE::075", "Eevee::MEW::133", "Eevee::SSP::143", "Electric Generator::SVI::170", "Elgyem::BLK::040", "Enamorus::TWM::093", "Energy Retrieval::SVI::171", "Energy Search Pro::SSP::176", "Energy Search::SVI::172", "Energy Sticker::MEW::159", "Energy Switch::SVI::173", "Enhanced Hammer::TWM::148", "Enriching Energy::SSP::191", "Eri::TEF::146", "Espathra ex::PAF::006", "Eternatus::SSP::141", "Ethan's Adventure::DRI::165", "Ethan's Cyndaquil::DRI::032", "Ethan's Ho-Oh ex::DRI::039", "Ethan's Pichu::DRI::071", "Ethan's Quilava::DRI::033", "Ethan's Sudowoodo::DRI::093", "Ethan's Typhlosion::DRI::034", "Exp. Share::SVI::174", "Explorer's Guidance::TEF::147", "Fan Rotom::SCR::118", "Farigiraf ex::TEF::108", "Feebas::SSP::041", "Feebas::TWM::049", "Feraligatr::TEF::041", "Festival Grounds::TWM::149", "Fezandipiti ex::SFA::038", "Fighting Energy::SVE::014", "Fire Energy::SVE::010", "Flamigo::PAR::106", "Flareon ex::PRE::014", "Flittle::PAR::080", "Flittle::SCR::068", "Flittle::SSP::094", "Flittle::SVI::100", "Flutter Mane::TEF::078", "Frillish::WHT::044", "Froakie::OBF::056", "Frogadier::TWM::057", "Froslass::TWM::053", "Future Booster Energy Capsule::TEF::149", "Galvantula ex::SCR::051", "Galvantula::SFA::002", "Gardevoir ex::SVI::086", "Genesect ex::BLK::067", "Genesect::SFA::040", "Gholdengo ex::PAR::139", "Gholdengo::SSP::131", "Gimmighoul::PAR::087", "Gimmighoul::PAR::088", "Gimmighoul::SSP::097", "Girafarig::PAL::154", "Girafarig::TEF::066", "Girafarig::TWM::083", "Glass Trumpet::SCR::135", "Glimmet::PAL::124", "Glimmora ex::OBF::123", "Gouging Fire ex::TEF::038", "Gouging Fire::SSP::038", "Grafaiai::PAL::146", "Grand Tree::SCR::136", "Grass Energy::SVE::009", "Gravity Gemstone::SCR::137", "Gravity Mountain::SSP::177", "Great Ball::PAL::183", "Great Tusk::TEF::097", "Greninja ex::TWM::106", "Grookey::TWM::014", "Handheld Fan::TWM::150", "Harlequin::WHT::083", "Hassel::TWM::151", "Hawlucha::SVI::118", "Hearthflame Mask Ogerpon ex::TWM::040", "Heavy Baton::TEF::151", "Hero's Cape::TEF::152", "Hilda::WHT::084", "Ho-Oh::SSP::019", "Hoopa ex::PAR::098", "Hoothoot::PRE::077", "Hoothoot::SCR::114", "Hoothoot::TEF::126", "Hop's Bag::JTG::147", "Hop's Choice Band::JTG::148", "Hop's Cramorant::JTG::138", "Hop's Dubwool::JTG::136", "Hop's Snorlax::JTG::117", "Hop's Wooloo::JTG::135", "Hop's Zacian ex::JTG::111", "Hydrapple::DRI::018", "Hydreigon ex::SSP::119", "Hyper Aroma::TWM::152", "Indeedee::SVI::153", "Iono::PAL::185", "Iron Bundle::PAR::056", "Iron Crown ex::TEF::081", "Iron Hands ex::PAR::070", "Iron Leaves ex::TEF::025", "Iron Thorns ex::TWM::077", "Iron Valiant ex::PAR::089", "Jacq::SVI::175", "Jamming Tower::TWM::153", "Janine's Secret Art::PRE::112", "Jellicent ex::WHT::045", "Jet Energy::PAL::190", "Joltik::SCR::050", "Judge::DRI::167", "Judge::SVI::176", "Kieran::TWM::154", "Kirlia::SVI::085", "Klawf::PAR::105", "Klefki::SVI::096", "Koraidon::SSP::116", "Koraidon::TEF::119", "Kyurem::SFA::047", "Lacey::SCR::139", "Lana's Aid::TWM::155", "Larry's Skill::PRE::115", "Larvitar::JTG::080", "Latias ex::SSP::076", "Leafeon ex::PRE::006", "Leftovers::MEW::163", "Legacy Energy::TWM::167", "Letter of Encouragement::OBF::189", "Levincia::JTG::150", "Lightning Energy::SVE::012", "Lillie's Clefairy ex::JTG::056", "Lillie's Pearl::JTG::151", "Lively Stadium::SSP::180", "Lokix::PAL::021", "Lucky Helmet::TWM::158", "Luminous Energy::PAL::191", "Luxray::PAL::071", "Luxurious Cape::PAR::166", "Magmar::MEW::126", "Magmortar::JTG::021", "Magnemite::SSP::058", "Magneton::SSP::059", "Mamoswine ex::JTG::079", "Mankey::SSP::098", "Maractus::JTG::008", "Marnie's Grimmsnarl ex::DRI::136", "Marnie's Impidimp::DRI::134", "Marnie's Morgrem::DRI::135", "Max Rod::PRE::116", "Maximum Belt::TEF::154", "Medical Energy::PAR::182", "Mesagoza::SVI::178", "Metal Energy::SVE::016", "Mew ex::MEW::151", "Milotic ex::SSP::042", "Mimikyu::PAL::097", "Minior::PAR::099", "Miraidon ex::SVI::081", "Miraidon::TEF::121", "Miriam::SVI::179", "Mist Energy::TEF::161", "Moonlit Hill::PAF::081", "Morty's Conviction::TEF::155", "Munkidori ex::SFA::037", "Munkidori::TWM::095", "Natu::PAR::071", "Neo Upper Energy::TEF::162", "Nest Ball::SVI::181", "Neutralization Zone::SFA::060", "Night Stretcher::SFA::061", "Noctowl::SCR::115", "N's Castle::JTG::152", "N's Darmanitan::JTG::027", "N's Darumaka::JTG::026", "N's PP Up::JTG::153", "N's Reshiram::JTG::116", "N's Sigilyph::JTG::064", "N's Zoroark ex::JTG::098", "N's Zorua::JTG::097", "Nymble::PAR::013", "Ogre's Mask::TWM::159", "Okidogi::TWM::111", "Pal Pad::SVI::182", "Pecharunt ex::SFA::039", "Pecharunt::SVP::149", "Penny::SVI::183", "Perilous Jungle::TEF::156", "Picnic Basket::SVI::184", "Pidgeot ex::OBF::164", "Pidgeotto::MEW::017", "Pidgeotto::OBF::163", "Pidgey::MEW::016", "Pidgey::OBF::162", "Pikachu ex::SSP::057", "Piloswine::JTG::078", "Poké Vital A::SFA::062", "Pokégear 3.0::SVI::186", "Pokémon Catcher::SVI::187", "Pokémon League Headquarters::OBF::192", "Postwick::JTG::154", "Powerglass::SFA::063", "Practice Studio::PAL::186", "Precious Trolley::SSP::185", "Prime Catcher::TEF::157", "Prism Energy::BLK::086", "Professor Sada's Vitality::PAR::170", "Professor Turo's Scenario::PAR::171", "Professor's Research::JTG::155", "Protective Goggles::MEW::164", "Psychic Energy::SVE::013", "Pupitar::PRE::048", "Rabsca::TEF::024", "Raging Bolt ex::TEF::123", "Raging Bolt::SCR::111", "Ralts::SVI::084", "Rare Candy::SVI::191", "Reboot Pod::TEF::158", "Redeemable Ticket::JTG::156", "Regigigas::PRE::086", "Relicanth::TEF::084", "Rellor::PAL::025", "Rellor::TEF::023", "Rescue Board::TEF::159", "Reshiram ex::WHT::020", "Revavroom::SVI::142", "Reversal Energy::PAL::192", "Rigid Band::MEW::165", "Roaring Moon ex::PAR::124", "Roaring Moon::TEF::109", "Rocky Helmet::SVI::193", "Ruffian::JTG::157", "Sacred Ash::DRI::168", "Sandy Shocks ex::PAR::108", "Scizor ex::TEF::111", "Scizor::OBF::141", "Scoop Up Cyclone::TWM::162", "Scream Tail::PAR::086", "Scyther::MEW::123", "Scyther::OBF::004", "Scyther::TEF::001", "Secret Box::TWM::163", "Shaymin::DRI::010", "Shroodle::SSP::120", "Shroodle::SVP::099", "Sizzlipede::SSP::027", "Sizzlipede::TEF::036", "Slaking ex::SSP::147", "Slakoth::PAL::160", "Slither Wing::PAR::107", "Slowking::SCR::058", "Slowpoke::PRE::018", "Slowpoke::SVI::042", "Snorunt::PAR::037", "Snorunt::TWM::051", "Sparkling Crystal::SCR::142", "Spikemuth Gym::DRI::169", "Squawkabilly ex::PAL::169", "Super Potion::JTG::158", "Super Rod::PAL::188", "Superior Energy Retrieval::PAL::189", "Surfer::SSP::187", "Survival Brace::TWM::164", "Swinub::JTG::077", "Switch::SVI::194", "Sylveon ex::SSP::086", "Tapu Koko ex::JTG::051", "Tatsugiri::TWM::131", "Teal Mask Ogerpon ex::TWM::025", "Team Rocket's Archer::DRI::170", "Team Rocket's Ariana::DRI::171", "Team Rocket's Articuno::DRI::051", "Team Rocket's Energy::DRI::182", "Team Rocket's Factory::DRI::173", "Team Rocket's Giovanni::DRI::174", "Team Rocket's Mewtwo ex::DRI::081", "Team Rocket's Mimikyu::DRI::087", "Team Rocket's Murkrow::DRI::127", "Team Rocket's Petrel::DRI::176", "Team Rocket's Proton::DRI::177", "Team Rocket's Spidops::DRI::020", "Team Rocket's Tarountula::DRI::019", "Team Rocket's Transceiver::DRI::178", "Team Rocket's Venture Bomb::DRI::179", "Team Rocket's Watchtower::DRI::180", "Team Rocket's Wobbuffet::DRI::082", "Technical Machine: Devolution::PAR::177", "Technical Machine: Evolution::PAR::178", "Technical Machine: Turbo Energize::PAR::179", "Techno Radar::PAR::180", "Tera Orb::SSP::189", "Terapagos ex::SCR::128", "Thwackey::TWM::015", "Ting-Lu ex::PAL::127", "Toedscool::OBF::118", "Toedscool::PAR::015", "Toedscool::PAR::016", "Toedscool::SCR::017", "Toedscool::SVI::025", "Toedscruel ex::OBF::022", "Toedscruel::PAR::017", "Togekiss::SSP::072", "Togepi::OBF::083", "Tool Scrapper::WHT::085", "Torchic::DRI::040", "Torchic::JTG::022", "Totodile::TEF::039", "Town Store::OBF::196", "Tyranitar::JTG::095", "Ultra Ball::SVI::196", "Umbreon ex::PRE::060", "Unfair Stamp::TWM::165", "Varoom::SFA::043", "Varoom::SVI::141", "Vengeful Punch::OBF::197", "Victini::SSP::021", "Vigoroth::PAL::161", "Vitality Band::SVI::197", "Volcanion ex::JTG::031", "Walking Wake ex::TEF::050", "Water Energy::SVE::011", "Wellspring Mask Ogerpon ex::TWM::064", "Xatu::PAR::072", "Xerosic's Machinations::SFA::064", "Zacian ex::SVP::198", "Zeraora::SCR::055", "Zweilous::SSP::118"
]);

// Extract unique sets from database cards
const DATABASE_SETS = new Set();
DATABASE_CARDS.forEach(card => {
  const parts = card.split('::');
  if (parts.length >= 2) {
    DATABASE_SETS.add(parts[1]);
  }
});

console.log(`Database contains ${DATABASE_CARDS.size} cards across ${DATABASE_SETS.size} sets:`, Array.from(DATABASE_SETS));

export async function onRequestGet({ env }) {
  try {
    console.log('Starting daily pricing update...');
    
    // Step 1: Get TCGCSV groups data
    const groupsResponse = await fetch(TCGCSV_GROUPS_URL);
    if (!groupsResponse.ok) {
      throw new Error(`TCGCSV groups API error: ${groupsResponse.status}`);
    }
    
    const groupsData = await groupsResponse.json();
    if (!groupsData.success) {
      throw new Error('TCGCSV groups API returned success: false');
    }

    // Step 2: Map our set abbreviations to TCGCSV group IDs
    const setMappings = mapSetsToGroupIds(groupsData.results);
    
    // Step 3: Download CSVs for each set and extract prices
    const priceData = await fetchPricesForSets(setMappings);
    
    // Step 3.5: Handle basic energy cards separately if needed
    await addBasicEnergyPrices(priceData, groupsData.results);
    
    // Step 4: Store the results
    await storePriceData(env, priceData);
    
    return new Response(JSON.stringify({ 
      success: true,
      setsProcessed: Object.keys(setMappings).length,
      cardsProcessed: Object.keys(priceData).length,
      databaseCards: DATABASE_CARDS.size,
      matchRate: `${((Object.keys(priceData).length / DATABASE_CARDS.size) * 100).toFixed(1)}%`,
      timestamp: new Date().toISOString()
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Pricing update error:', error);
    
    return new Response(JSON.stringify({ 
      error: 'Pricing update failed',
      message: error.message,
      timestamp: new Date().toISOString()
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Map database set abbreviations to TCGCSV group IDs
 * Only maps sets that actually exist in our database
 */
function mapSetsToGroupIds(groups) {
  const mappings = {};
  
  for (const setAbbr of DATABASE_SETS) {
    // Find the group with matching abbreviation
    const group = groups.find(g => g.abbreviation === setAbbr);
    if (group) {
      mappings[setAbbr] = group.groupId;
      console.log(`Found mapping: ${setAbbr} -> ${group.groupId} (${group.name})`);
    } else {
      console.warn(`No TCGCSV group found for database set: ${setAbbr}`);
    }
  }
  
  return mappings;
}

/**
 * Download and parse CSV data for each set
 * Extract only the data we need: name, set number, market price
 */
async function fetchPricesForSets(setMappings) {
  const allPrices = {};
  
  for (const [setAbbr, groupId] of Object.entries(setMappings)) {
    if (!groupId) continue;
    
    try {
      console.log(`Fetching prices for set: ${setAbbr} (${groupId})`);
      const csvUrl = `https://tcgcsv.com/tcgplayer/3/${groupId}/ProductsAndPrices.csv`;
      
      const response = await fetch(csvUrl);
      if (!response.ok) {
        console.warn(`Failed to fetch CSV for ${setAbbr}: ${response.status}`);
        continue;
      }
      
      const csvText = await response.text();
      const setPrices = parseCsvPrices(csvText, setAbbr);
      
      // Merge into main price data
      Object.assign(allPrices, setPrices);
      
      console.log(`Processed ${Object.keys(setPrices).length} cards from ${setAbbr}`);
      
    } catch (error) {
      console.error(`Error processing set ${setAbbr}:`, error);
      // Continue with other sets
    }
  }
  
  return allPrices;
}

/**
 * Normalize multi-line CSV records into single lines
 * Uses product ID pattern (6+ digit number at start) to detect new records
 * This handles TCGCSV's malformed entries where descriptions span multiple lines
 */
function normalizeCsvText(csvText) {
  const lines = csvText.split('\n');
  const normalizedLines = [];
  let currentRecord = '';
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue; // Skip empty lines
    
    // Check if this line starts a new record (6+ digit product ID at the beginning)
    const isNewRecord = /^\d{6,},/.test(line);
    
    if (isNewRecord && currentRecord) {
      // We found a new record and have a current record to save
      normalizedLines.push(currentRecord);
      currentRecord = line;
    } else if (isNewRecord && !currentRecord) {
      // First record or start of a new record
      currentRecord = line;
    } else if (i === 0) {
      // Handle header line
      normalizedLines.push(line);
    } else {
      // Continuation of current record - append with space
      currentRecord += ' ' + line;
    }
  }
  
  // Add the final record
  if (currentRecord.trim()) {
    normalizedLines.push(currentRecord);
  }
  
  console.log(`Normalized ${lines.length} raw lines into ${normalizedLines.length} records`);
  return normalizedLines;
}

/**
 * Parse CSV and extract price data
 * ONLY returns prices for cards that exist in our database
 */
function parseCsvPrices(csvText, setAbbr) {
  const prices = {};
  
  // Normalize multi-line CSV records first (fixes PAL Luminous Energy etc.)
  const lines = normalizeCsvText(csvText);
  
  if (lines.length < 2) {
    console.warn(`Invalid CSV format for set ${setAbbr}`);
    return prices;
  }
  
  console.log(`Processing ${lines.length} normalized lines for ${setAbbr}`);
  
  // Skip header line
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    try {
      // Parse CSV line - be careful with commas in quoted strings
      const fields = parseCSVLine(line);
      
      if (fields.length < 10) continue; // Need reasonable number of fields
      
      const name = fields[1]; // Card name
      
      // CRITICAL FIX: Find price fields dynamically due to TCGCSV inconsistent format
      const priceData = extractPricesFromFields(fields);
      const marketPrice = priceData.marketPrice;
      const extNumber = priceData.extNumber;
      
      if (!name || !extNumber || isNaN(marketPrice) || marketPrice <= 0) continue;
      
      // Clean up the card name and number
      let cleanName = name.replace(/['"]/g, '').trim();
      
      // SPECIAL CASE: Remove embedded card numbers from name field
      // e.g., "Superior Energy Retrieval - 189/193" -> "Superior Energy Retrieval"  
      cleanName = cleanName.replace(/\s*-\s*\d{1,3}\/\d{2,3}$/, '').trim();
      
      const cleanNumber = extNumber.split('/')[0]; // Take just the number part (before slash)
      
      // Debug problematic cards
      if (name && (name.toLowerCase().includes('ceruledge') || name.toLowerCase().includes('energy retrieval') || name.toLowerCase().includes('luminous energy') || name.toLowerCase().includes('dunsparce') || name.toLowerCase().includes('superior energy'))) {
        console.log(`DEBUG ${name} (${setAbbr}):`);
        console.log(`  Total fields: ${fields.length}`);
        console.log(`  Raw fields 10-20:`, fields.slice(10, 21));
        console.log(`  Found prices:`, priceData);
        console.log(`  Using marketPrice: ${marketPrice}`);
        console.log(`  ExtNumber: "${extNumber}"`);
        console.log(`  Card key: "${cleanName}::${setAbbr}::${cleanNumber.padStart(3, '0')}"`);
        console.log(`  In database: ${DATABASE_CARDS.has(`${cleanName}::${setAbbr}::${cleanNumber.padStart(3, '0')}`)}`);
      }
      
      // Create the card key in your format
      const cardKey = `${cleanName}::${setAbbr}::${cleanNumber.padStart(3, '0')}`;
      
      // CRITICAL: Only include cards that exist in our database
      if (DATABASE_CARDS.has(cardKey)) {
        const tcgPlayerId = fields[0]; // First field is always the TCGPlayer ID
        prices[cardKey] = {
          price: marketPrice,
          tcgPlayerId: tcgPlayerId
        };
      }
      
    } catch (error) {
      // Skip malformed lines
      continue;
    }
  }
  
  console.log(`Found ${Object.keys(prices).length} database cards in ${setAbbr} set`);
  return prices;
}

/**
 * Add basic energy card prices if they exist in database
 * Basic energies are often in a separate set or have special pricing
 */
async function addBasicEnergyPrices(priceData, allGroups) {
  // ONLY set the 8 basic energy types to $0.01 if missing
  // All other energy cards should get real prices from their respective sets
  const basicEnergyTypes = [
    'Darkness Energy', 'Fighting Energy', 'Fire Energy', 'Grass Energy',
    'Lightning Energy', 'Metal Energy', 'Psychic Energy', 'Water Energy'
  ];
  
  // Find any missing basic energy cards and set to $0.01
  const missingBasicEnergies = Array.from(DATABASE_CARDS).filter(card => {
    if (priceData[card]) return false; // Already have price
    
    const cardName = card.split('::')[0];
    return basicEnergyTypes.includes(cardName);
  });
  
  if (missingBasicEnergies.length > 0) {
    console.log(`Setting ${missingBasicEnergies.length} basic energy cards to $0.01:`, missingBasicEnergies);
    missingBasicEnergies.forEach(card => {
      priceData[card] = {
        price: 0.01, // Only basic energies are practically free
        tcgPlayerId: null // Basic energies don't have TCGPlayer IDs
      };
    });
  }
  
  // SPECIAL CASE: Handle known malformed energy cards with reasonable default prices
  const knownMalformedCards = [
    'Superior Energy Retrieval::PAL::189'
  ];
  
  knownMalformedCards.forEach(card => {
    if (!priceData[card] && DATABASE_CARDS.has(card)) {
      priceData[card] = {
        price: 0.75, // Reasonable default for special energy cards
        tcgPlayerId: null // Malformed entries don't have reliable TCGPlayer IDs
      };
      console.log(`Applied fallback price for malformed CSV entry: ${card} = $0.75`);
    }
  });
  
  // Report any other missing energy-related cards (but don't set prices - they should come from regular CSV parsing)
  const allEnergyCards = Array.from(DATABASE_CARDS).filter(card => 
    card.toLowerCase().includes('energy')
  );
  
  const otherMissingEnergies = allEnergyCards.filter(card => {
    if (priceData[card]) return false;
    const cardName = card.split('::')[0];
    return !basicEnergyTypes.includes(cardName);
  });
  
  if (otherMissingEnergies.length > 0) {
    console.warn(`Missing prices for special energy cards (should come from regular sets):`, otherMissingEnergies);
  }
  
  console.log(`Energy processing complete: ${allEnergyCards.length} total energy cards, ${missingBasicEnergies.length} set to $0.01`);
}

/**
 * Extract price data from CSV fields, handling TCGCSV's inconsistent field structure
 * TCGCSV has variable field counts due to missing data, so we need dynamic parsing
 */
function extractPricesFromFields(fields) {
  // MUCH MORE ROBUST parsing for TCGCSV's inconsistent field structures
  
  // 1. Find extNumber by scanning ALL fields for card number pattern
  let extNumber = null;
  let numberFieldIndex = -1;
  
  // Look for any field with pattern like "123/456" - card numbers can be 1-3 digits  
  for (let i = 5; i < fields.length; i++) {
    if (fields[i] && fields[i].match(/^\d{1,3}\/\d{2,3}$/)) {
      extNumber = fields[i];
      numberFieldIndex = i;
      break;
    }
  }
  
  // SPECIAL CASE: If no extNumber found, check if it's embedded in name field (field[1])
  // This handles malformed entries like "Superior Energy Retrieval - 189/193"
  if (!extNumber && fields[1]) {
    const nameField = fields[1];
    const numberMatch = nameField.match(/(\d{1,3}\/\d{2,3})/);
    if (numberMatch) {
      extNumber = numberMatch[1];
      console.log(`Found embedded extNumber in name field: "${nameField}" -> "${extNumber}"`);
    }
  }
  
  // 2. Find price fields by scanning ALL numeric fields in reasonable range
  const prices = {};
  const potentialPrices = [];
  
  // Scan much broader range since CSV structures vary wildly between sets
  for (let i = 5; i < Math.min(30, fields.length); i++) {
    const field = fields[i];
    // Look for decimal numbers that could be prices (0.01 to 999.99)
    if (field && field.match(/^\d{1,3}(\.\d{1,2})?$/) && parseFloat(field) >= 0.01 && parseFloat(field) <= 999.99) {
      potentialPrices.push({
        index: i,
        value: parseFloat(field)
      });
    }
  }
  
  // 3. Smart price selection logic
  // TCGCSV typically has: lowPrice, midPrice, highPrice, marketPrice, directLowPrice
  // We want marketPrice when available, or a reasonable middle price
  
  let marketPrice = 0;
  
  if (potentialPrices.length >= 4) {
    // With 4+ prices, sort and pick the 2nd lowest as market price
    // This avoids the lowest (which might be lowPrice) and highest (which might be highPrice)
    const sorted = potentialPrices.sort((a, b) => a.value - b.value);
    marketPrice = sorted[1].value;
    prices.lowPrice = sorted[0].value;
    prices.marketPrice = sorted[1].value; 
    prices.highPrice = sorted[sorted.length - 1].value;
  } else if (potentialPrices.length === 3) {
    // With 3 prices, take the middle one
    const sorted = potentialPrices.sort((a, b) => a.value - b.value);
    marketPrice = sorted[1].value;
    prices.marketPrice = sorted[1].value;
  } else if (potentialPrices.length === 2) {
    // With 2 prices, take the lower one (avoid high prices)
    const sorted = potentialPrices.sort((a, b) => a.value - b.value);
    marketPrice = sorted[0].value;
    prices.marketPrice = sorted[0].value;
  } else if (potentialPrices.length === 1) {
    // With 1 price, use it
    marketPrice = potentialPrices[0].value;
    prices.marketPrice = potentialPrices[0].value;
  }
  
  // SPECIAL HANDLING: For cards with valid extNumber but no price data (malformed CSV entries)
  // Assign a reasonable default price rather than skipping the card entirely
  if (extNumber && marketPrice === 0 && potentialPrices.length === 0) {
    // Check if this might be a special energy card that should have a reasonable price
    const possibleName = (fields[1] || '').toLowerCase();
    if (possibleName.includes('energy') && !possibleName.includes('basic')) {
      marketPrice = 0.50; // Reasonable default for special energy cards
      console.log(`Applied default price $${marketPrice} for malformed energy card: ${fields[1]}`);
    }
  }
  
  return {
    extNumber: extNumber ? extNumber.split('/')[0] : null,
    marketPrice: marketPrice,
    lowPrice: prices.lowPrice || 0,
    highPrice: prices.highPrice || 0,
    priceCount: potentialPrices.length,
    allPrices: potentialPrices.map(p => p.value), // For debugging
    hadMalformedData: (extNumber && potentialPrices.length === 0) // Track malformed entries
  };
}

/**
 * RFC 4180 compliant CSV parser that properly handles quotes and escapes
 */
function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  let i = 0;
  
  while (i < line.length) {
    const char = line[i];
    
    if (char === '"') {
      if (!inQuotes) {
        // Starting quoted field
        inQuotes = true;
      } else if (i + 1 < line.length && line[i + 1] === '"') {
        // Escaped quote (double quote within quotes)
        current += '"';
        i++; // Skip the second quote
      } else {
        // Ending quoted field
        inQuotes = false;
      }
    } else if (char === ',' && !inQuotes) {
      // Field separator outside of quotes
      fields.push(current);
      current = '';
    } else {
      // Regular character
      current += char;
    }
    
    i++;
  }
  
  // Add the last field
  fields.push(current);
  
  // Trim whitespace from non-quoted fields only
  return fields.map(field => field.trim());
}

/**
 * Store price data using CloudFlare KV or return for external storage
 */
async function storePriceData(env, priceData) {
  const jsonData = {
    lastUpdated: new Date().toISOString(),
    updateSource: 'TCGCSV',
    cardPrices: priceData
  };
  
  // If KV binding exists, store there
  if (env.PRICE_DATA) {
    await env.PRICE_DATA.put('current_prices', JSON.stringify(jsonData));
    console.log('Price data stored in KV');
  }
  
  // Also log summary for debugging
  console.log(`Price update complete: ${Object.keys(priceData).length} cards updated`);
  
  return jsonData;
}