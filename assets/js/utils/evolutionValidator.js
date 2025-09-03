/**
 * Pokemon Evolution Validation System
 * Validates evolution chains in Pokemon TCG decks according to game rules
 * @module evolutionValidator
 */

import { logger } from './logger.js';

// Evolution chain data parsed from project requirements
const EVOLUTION_CHAINS = {
  // Basic -> Stage 1 -> Stage 2 chains
  'Abra': ['Kadabra', 'Alakazam'],
  'Kadabra': ['Alakazam'],

  'Honedge': ['Doublade', 'Aegislash'],
  'Doublade': ['Aegislash'],

  'Mankey': ['Primeape', 'Annihilape'],
  'Primeape': ['Annihilape'],

  'Applin': ['Dipplin', 'Hydrapple', 'Appletun', 'Flapple'], // Multiple evolution paths
  'Dipplin': ['Hydrapple'],

  'Frigibax': ['Arctibax', 'Baxcalibur'],
  'Arctibax': ['Baxcalibur'],

  'Axew': ['Fraxure', 'Haxorus'],
  'Fraxure': ['Haxorus'],

  'Beldum': ['Metang', 'Metagross'],
  'Metang': ['Metagross'],

  'Squirtle': ['Wartortle', 'Blastoise'],
  'Wartortle': ['Blastoise'],

  'Torchic': ['Combusken', 'Blaziken'],
  'Combusken': ['Blaziken'],

  'Bounsweet': ['Steenee', 'Tsareena'],
  'Steenee': ['Tsareena'],

  'Charmander': ['Charmeleon', 'Charizard'],
  'Charmeleon': ['Charizard'],

  'Chimchar': ['Monferno', 'Infernape'],
  'Monferno': ['Infernape'],

  'Scorbunny': ['Raboot', 'Cinderace'],
  'Raboot': ['Cinderace'],

  'Bulbasaur': ['Ivysaur', 'Venusaur'],
  'Ivysaur': ['Venusaur'],

  'Chikorita': ['Bayleef', 'Meganium'],
  'Bayleef': ['Meganium'],

  'Sobble': ['Drizzile', 'Inteleon'],
  'Drizzile': ['Inteleon'],

  'Zubat': ['Golbat', 'Crobat'],
  'Golbat': ['Crobat'],

  'Fuecoco': ['Crocalor', 'Skeledirge'],
  'Crocalor': ['Skeledirge'],

  'Totodile': ['Croconaw', 'Feraligatr'],
  'Croconaw': ['Feraligatr'],

  'Rowlet': ['Dartrix', 'Decidueye'],
  'Dartrix': ['Decidueye'],

  'Deino': ['Zweilous', 'Hydreigon'],
  'Zweilous': ['Hydreigon'],

  'Dreepy': ['Drakloak', 'Dragapult'],
  'Drakloak': ['Dragapult'],

  'Duskull': ['Dusclops', 'Dusknoir'],
  'Dusclops': ['Dusknoir'],

  'Tynamo': ['Eelektrik', 'Eelektross'],
  'Eelektrik': ['Eelektross'],

  // Eevee evolution tree (9 evolutions)
  'Eevee': ['Vaporeon', 'Jolteon', 'Flareon', 'Espeon', 'Umbreon', 'Leafeon', 'Glaceon', 'Sylveon'],

  'Elekid': ['Electabuzz', 'Electivire'], // Baby -> Basic -> Stage 1
  'Electabuzz': ['Electivire'],

  'Tepig': ['Pignite', 'Emboar'],
  'Pignite': ['Emboar'],

  'Cyndaquil': ['Quilava', 'Typhlosion'],
  'Quilava': ['Typhlosion'],

  'Pichu': ['Pikachu', 'Raichu'], // Baby -> Basic -> Stage 1
  'Pikachu': ['Raichu'],

  'Froakie': ['Frogadier', 'Greninja'],
  'Frogadier': ['Greninja'],

  'Trapinch': ['Vibrava', 'Flygon'],
  'Vibrava': ['Flygon'],

  'Sprigatito': ['Floragato', 'Meowscarada'],
  'Floragato': ['Meowscarada'],

  'Ralts': ['Kirlia', 'Gardevoir', 'Gallade'], // Multiple evolution paths at Stage 1
  'Kirlia': ['Gardevoir', 'Gallade'],

  'Nacli': ['Naclstack', 'Garganagl'],
  'Naclstack': ['Garganagl'],

  'Gastly': ['Haunter', 'Gengar'],
  'Haunter': ['Gengar'],

  'Gothita': ['Gothorita', 'Gothitelle'],
  'Gothorita': ['Gothitelle'],

  'Grookey': ['Thwackey', 'Rillaboom'],
  'Thwackey': ['Rillaboom'],

  'Hoothoot': ['Noctowl'],
  'Horsea': ['Seadra', 'Kingdra'],
  'Seadra': ['Kingdra'],

  'Igglybuff': ['Jigglypuff', 'Wigglytuff'], // Baby -> Basic -> Stage 1
  'Jigglypuff': ['Wigglytuff'],

  'Pawniard': ['Bisharp', 'Kingambit'],
  'Bisharp': ['Kingambit'],

  'Klink': ['Klang', 'Klinklang'],
  'Klang': ['Klinklang'],

  'Lotad': ['Lombre', 'Ludicolo'],
  'Lombre': ['Ludicolo'],

  'Magnemite': ['Magneton', 'Magnezone'],
  'Magneton': ['Magnezone'],

  'Magby': ['Magmar', 'Magmortar'], // Baby -> Basic -> Stage 1
  'Magmar': ['Magmortar'],

  'Swinub': ['Piloswine', 'Mamoswine'],
  'Piloswine': ['Mamoswine'],

  'Impidimp': ['Morgrem', 'Grimmsnarl'],
  'Morgrem': ['Grimmsnarl'],

  'Pidgey': ['Pidgeotto', 'Pidgeot'],
  'Pidgeotto': ['Pidgeot'],

  'Poliwag': ['Poliwhirl', 'Poliwrath'],
  'Poliwhirl': ['Poliwrath'],

  'Dratini': ['Dragonair', 'Dragonite'],
  'Dragonair': ['Dragonite'],

  'Bellsprout': ['Weepinbell', 'Victrebell'],
  'Weepinbell': ['Victrebell'],

  'Weedle': ['Kakuna', 'Beedrill'],
  'Kakuna': ['Beedrill'],

  // Basic -> Stage 1 only chains
  'Diglett': ['Dugtrio'],
  'Exeggcute': ['Exeggutor', 'Alolan Exeggutor'], // Multiple variants
  'Foongus': ['Amoonguss'],
  'Shelmet': ['Accelgor'],
  'Duraludon': ['Archaludon'],
  'Archen': ['Archeops'],
  'Spinarak': ['Ariados'],
  'Charcadet': ['Armarouge', 'Ceruledge'], // Multiple evolution paths
  'Skwovet': ['Greedent'],
  'Maschiff': ['Mabosstiff'],
  'Sizzlipede': ['Centiskorch'],
  'Minccino': ['Cinccino'],
  'Clamperl': ['Huntail', 'Gorebyss'], // Multiple evolution paths
  'Cottonee': ['Whimsicott'],
  'Carvanha': ['Sharpedo'],
  'Toxel': ['Toxtricity'],
  'Milcery': ['Alcremie'],
  'Vulpix': ['Ninetales'],
  'Numel': ['Camerupt'],
  'Corphish': ['Crawdaunt'],
  'Onix': ['Steelix'],
  'Makuhita': ['Hariyama'],
  'Croagunk': ['Toxicroak'],
  'Nickit': ['Thievul'],
  'Yungoos': ['Gumshoos'],
  'Tangela': ['Tangrowth'],
  'Nincada': ['Ninjask'],
  'Litleo': ['Pyroar'],
  'Snover': ['Abomasnow'],
  'Snom': ['Frosmoth'],
  'Electrike': ['Manetric'],
  'Helioptile': ['Heliolisk'],
  'Spoink': ['Grumpig'],
  'Greavard': ['Houndstone'],
  'Buneary': ['Lopunny'],
  'Stufful': ['Bewear'],
  'Clauncher': ['Clawitzer'],
  'Combee': ['Vespiquen'],
  'Cufant': ['Copperajah'],
  'Snorunt': ['Glalie', 'Froslass'], // Multiple evolution paths
  'Dwebble': ['Crustle'],
  'Cubchoo': ['Beartic'],
  'Cubone': ['Marowak'],
  'Gible': ['Gabite', 'Garchomp'],
  'Gabite': ['Garchomp'],
  'Deerling': ['Sawsbuck'],
  'Doduo': ['Dodrio'],
  'Drilbur': ['Excadrill'],
  'Dunsparce': ['Dudunsparce'],
  'Voltorb': ['Electrode'],
  'Slugma': ['Magcargo'],
  'Flittle': ['Espathra'],
  'Spearow': ['Fearow'],
  'Feebas': ['Milotic'],
  'Finizen': ['Palafin'],
  'Frillish': ['Jellicent'],
  'Joltik': ['Galvantula'],
  'Trubbish': ['Garbodor'],
  'Glimmet': ['Glimmora'],
  'Goldeen': ['Seaking'],
  'Shroodle': ['Grafaiai'],
  'Murkrow': ['Honchkrow'],
  'Wooloo': ['Dubwool'],
  'Tadbulb': ['Bellibolt'],
  'Wattrel': ['Kilowattrel'],
  'Purrloin': ['Liepard'],
  'Cutiefly': ['Ribombee'],
  'Petilil': ['Lilligant'],
  'Shinx': ['Luxio', 'Luxray'],
  'Luxio': ['Luxray'],
  'Nymble': ['Lokix'],
  'Misdreavus': ['Mismagius'],
  'Darumaka': ['Darmanitan'],
  'Zorua': ['Zoroark'],
  'Natu': ['Xatu'],
  'Noibat': ['Noivern'],
  'Sandygast': ['Palossand'],
  'Wingull': ['Pelipper'],
  'Rellor': ['Rabsca'],
  'Remoraid': ['Octillery'],
  'Magikarp': ['Gyarados'],
  'Houndour': ['Houndoom'],
  'Aron': ['Lairon', 'Aggron'],
  'Lairon': ['Aggron'],
  'Meditite': ['Medicham'],
  'Slowpoke': ['Slowbro', 'Slowking'], // Multiple evolution paths
  'Treecko': ['Grovyle', 'Sceptile'],
  'Grovyle': ['Sceptile'],
  'Mudkip': ['Marshtomp', 'Swampert'],
  'Marshtomp': ['Swampert'],
  'Bagon': ['Shelgon', 'Salamence'],
  'Shelgon': ['Salamence'],
  'Riolu': ['Lucario'],
  'Varoom': ['Revavroom'],
  'Salandit': ['Salazzle'],
  'Sandshrew': ['Sandslash'],
  'Scyther': ['Scizor'],
  'Capsakid': ['Scovillain'],
  'Venipede': ['Whirlipede', 'Scolipede'],
  'Whirlipede': ['Scolipede'],
  'Shellos': ['Gastrodon'],
  'Seedot': ['Nuzleaf', 'Shiftry'],
  'Nuzleaf': ['Shiftry'],
  'Slakoth': ['Vigoroth', 'Slaking'],
  'Vigoroth': ['Slaking'],
  'Sneasel': ['Weavile'],
  'Tarountula': ['Spidops'],
  'Staryu': ['Starmie'],
  'Swirlix': ['Slurpuff'],
  'Spritzee': ['Aromatisse'],
  'Ekans': ['Arbok'],
  'Mareep': ['Flaaffy', 'Ampharos'],
  'Flaaffy': ['Ampharos'],
  'Grimer': ['Muk'],
  'Larvitar': ['Pupitar', 'Tyranitar'],
  'Pupitar': ['Tyranitar'],
  'Meowth': ['Persian'],
  'Porygon': ['Porygon2', 'Porygon-Z'],
  'Porygon2': ['Porygon-Z'],
  'Tinkatink': ['Tinkatuff', 'Tinkaton'],
  'Tinkatuff': ['Tinkaton'],
  'Toedscool': ['Toedscruel'],
  'Tirtouga': ['Carracosta'],
  'Togepi': ['Togetic', 'Togekiss'],
  'Togetic': ['Togekiss'],
  'Venonat': ['Venomoth'],
  'Wailmer': ['Wailord'],
  'Yanma': ['Yanmega'],
  'Wiglett': ['Wugtrio'],
  'Gimmighoul': ['Gholdengo'],
  'Poltchageist': ['Sinistcha'],
  'Chansey': ['Blissey'],
  'Timburr': ['Gurdurr', 'Conkeldurr'],
  'Gurdurr': ['Conkeldurr'],
  'Cleffa': ['Clefairy', 'Clefable'], // Baby -> Basic -> Stage 1
  'Clefairy': ['Clefable'],
  'Yamask': ['Cofagrigus'],
  'Baltoy': ['Claydol'],
  'Shuppet': ['Banette']
};

// Baby Pokemon (can be played alone, but are not required for evolution)
const BABY_POKEMON = new Set([
  'Azurill', 'Budew', 'Mantyke', 'Smoochum', 'Cleffa', 'Elekid', 'Pichu',
  'Igglybuff', 'Magby', 'Bonsly'
]);

// Special exception cards that can be played without smaller evolutions
const EVOLUTION_EXCEPTIONS = new Set([
  'Klinklang SCR 101', // Can be put down conditionally
  'Luxray PAL 071' // Can be put down conditionally
]);

// Cards that allow bypassing evolution checks
const EVOLUTION_BYPASS_CARDS = new Set([
  'Slowking SCR 058' // Bypasses check if deck also contains Slowpoke
]);

/**
 * Get the base name of a Pokemon card (removes ex, variants, etc.)
 * @param {string} cardName - Full card name
 * @returns {string} Base Pokemon name
 */
function getBasePokemonName(cardName) {
  // Remove ex suffix
  let baseName = cardName.replace(/\s+ex$/i, '');

  // Handle named variants (e.g., "Cynthia's Gible" -> "Gible")
  const namedVariantMatch = baseName.match(/^(.+?)'s\s+(.+)$/);
  if (namedVariantMatch) {
    return namedVariantMatch[2]; // Return the Pokemon name part
  }

  // Handle regional variants (e.g., "Alolan Diglett" -> "Diglett")
  baseName = baseName.replace(/^(Alolan|Galarian|Hisuian|Paldean)\s+/, '');

  return baseName.trim();
}

/**
 * Get the trainer name from a named variant card
 * @param {string} cardName - Full card name
 * @returns {string|null} Trainer name or null if not a named variant
 */
function getTrainerName(cardName) {
  const namedVariantMatch = cardName.match(/^(.+?)'s\s+.+$/);
  return namedVariantMatch ? namedVariantMatch[1] : null;
}

/**
 * Check if a card is an ex Pokemon
 * @param {string} cardName - Card name to check
 * @returns {boolean} True if card is ex Pokemon
 */
function isExPokemon(cardName) {
  return /\s+ex$/i.test(cardName);
}

/**
 * Check if a card is a baby Pokemon
 * @param {string} cardName - Card name to check
 * @returns {boolean} True if card is baby Pokemon
 */
function isBabyPokemon(cardName) {
  const baseName = getBasePokemonName(cardName);
  return BABY_POKEMON.has(baseName);
}

/**
 * Get all Pokemon that can evolve into the given Pokemon
 * @param {string} pokemonName - Target Pokemon name
 * @returns {string[]} Array of Pokemon that can evolve into target
 */
function getPreEvolutions(pokemonName) {
  const baseName = getBasePokemonName(pokemonName);
  const preEvolutions = [];

  // Search through evolution chains to find what evolves into this Pokemon
  for (const [prevo, evolutions] of Object.entries(EVOLUTION_CHAINS)) {
    if (evolutions.includes(baseName)) {
      preEvolutions.push(prevo);
    }
  }

  return preEvolutions;
}

/**
 * Get all Pokemon that the given Pokemon can evolve into
 * @param {string} pokemonName - Base Pokemon name
 * @returns {string[]} Array of Pokemon this can evolve into
 */
function getEvolutions(pokemonName) {
  const baseName = getBasePokemonName(pokemonName);
  return EVOLUTION_CHAINS[baseName] || [];
}

/**
 * Check if two cards are compatible for named variants
 * @param {string} evolution - Evolution card name
 * @param {string} basic - Basic card name
 * @returns {boolean} True if named variants are compatible
 */
function areNamedVariantsCompatible(evolution, basic) {
  const evolutionTrainer = getTrainerName(evolution);
  const basicTrainer = getTrainerName(basic);

  // Both must have same trainer name, or both must have no trainer name
  if (evolutionTrainer && basicTrainer) {
    return evolutionTrainer === basicTrainer;
  }

  return evolutionTrainer === basicTrainer; // Both null, or one null one not
}

/**
 * Validate evolution requirements for a deck
 * @param {Map} deck - Map of card name -> {card, count}
 * @returns {Array} Array of validation warnings
 */
export function validateEvolutionRequirements(deck) {
  const warnings = [];
  const deckCards = new Map(); // Pokemon name -> {count, isEx, trainerName}
  const hasSlowkingBypass = new Map(); // Track Slowking bypass

  // Process all cards in deck
  for (const [cardName, deckEntry] of deck) {
    const { card, count } = deckEntry;

    // Skip non-Pokemon cards
    if (!card || !isPokemonCard(card)) {
      continue;
    }

    const baseName = getBasePokemonName(cardName);
    const trainerName = getTrainerName(cardName);
    const cardKey = trainerName ? `${trainerName}'s ${baseName}` : baseName;

    // Track card counts
    if (!deckCards.has(cardKey)) {
      deckCards.set(cardKey, {
        count: 0,
        isEx: false,
        trainerName,
        originalNames: new Set()
      });
    }

    const entry = deckCards.get(cardKey);
    entry.count += count;
    entry.originalNames.add(cardName);

    if (isExPokemon(cardName)) {
      entry.isEx = true;
    }

    // Check for Slowking bypass
    if (cardName.includes('Slowking') && EVOLUTION_BYPASS_CARDS.has(cardName)) {
      hasSlowkingBypass.set('Slowpoke', true);
    }
  }

  // Validate evolution requirements
  for (const [cardKey, entry] of deckCards) {
    const baseName = getBasePokemonName(cardKey);
    const { trainerName } = entry;

    // Debug logging for Gardevoir
    if (baseName === 'Gardevoir') {
      console.log('DEBUGGING GARDEVOIR:', {
        cardKey,
        baseName,
        isEx: entry.isEx,
        originalNames: Array.from(entry.originalNames),
        preEvolutions: getPreEvolutions(baseName)
      });
    }

    // Skip baby Pokemon (they don't need pre-evolutions)
    if (isBabyPokemon(cardKey)) {
      continue;
    }

    // Check for evolution exceptions
    let hasException = false;
    for (const originalName of entry.originalNames) {
      if (EVOLUTION_EXCEPTIONS.has(originalName)) {
        hasException = true;
        break;
      }
    }

    if (hasException) {
      continue; // Skip validation for exception cards
    }

    // Get required pre-evolutions
    const preEvolutions = getPreEvolutions(baseName);

    if (preEvolutions.length === 0) {
      continue; // Basic Pokemon, no pre-evolution required
    }

    // Check if any required pre-evolution exists in deck
    let hasPreEvolution = false;
    const compatiblePreEvolutions = [];

    for (const preEvo of preEvolutions) {
      const preEvoKey = trainerName ? `${trainerName}'s ${preEvo}` : preEvo;

      if (deckCards.has(preEvoKey)) {
        hasPreEvolution = true;
        compatiblePreEvolutions.push(preEvoKey);
      }

      // Also check for non-named variants if this is a named variant
      if (trainerName && deckCards.has(preEvo)) {
        // Named variants can't evolve from non-named variants normally
        // But we'll note this as a potential issue
      }
    }

    // Check for Slowking bypass special case
    if (baseName === 'Slowking' && hasSlowkingBypass.has('Slowpoke') &&
        deckCards.has('Slowpoke')) {
      hasPreEvolution = true;
    }

    // Generate warnings based on validation results
    if (!hasPreEvolution) {
      const cardDisplayNames = Array.from(entry.originalNames).join(', ');

      if (entry.isEx) {
        warnings.push({
          type: 'evolution_missing',
          severity: 'warning',
          message: `${cardDisplayNames}: ex Pokemon without required pre-evolution. ` +
                  `Needs one of: ${preEvolutions.join(', ')}.`,
          cardName: cardKey,
          missingPreEvolutions: preEvolutions
        });
      } else {
        warnings.push({
          type: 'evolution_missing',
          severity: 'error',
          message: `${cardDisplayNames}: Evolution Pokemon played without smaller stage. ` +
                  `Needs one of: ${preEvolutions.join(', ')}.`,
          cardName: cardKey,
          missingPreEvolutions: preEvolutions
        });
      }
    }

    // Check for named variant compatibility issues
    if (trainerName && hasPreEvolution) {
      let hasCompatiblePreEvo = false;

      for (const preEvo of preEvolutions) {
        const namedPreEvoKey = `${trainerName}'s ${preEvo}`;
        if (deckCards.has(namedPreEvoKey)) {
          hasCompatiblePreEvo = true;
          break;
        }
      }

      if (!hasCompatiblePreEvo) {
        // Has pre-evolution but it's not the matching named variant
        const cardDisplayNames = Array.from(entry.originalNames).join(', ');
        warnings.push({
          type: 'named_variant_mismatch',
          severity: 'warning',
          message: `${cardDisplayNames}: Named variant should evolve from matching ` +
                  `trainer's card (e.g., ${trainerName}'s ${preEvolutions[0]}).`,
          cardName: cardKey,
          expectedPreEvolutions: preEvolutions.map(p => `${trainerName}'s ${p}`)
        });
      }
    }
  }

  // Check for ex Pokemon evolution restrictions
  for (const [cardKey, entry] of deckCards) {
    if (!entry.isEx) {continue;}

    const baseName = getBasePokemonName(cardKey);
    const evolutions = getEvolutions(baseName);

    // Special case: Eevee ex can evolve
    if (baseName === 'Eevee') {
      continue;
    }

    if (evolutions.length > 0) {
      // Check if deck contains evolution stages of this ex Pokemon
      for (const evolution of evolutions) {
        const evolutionKey = entry.trainerName ?
          `${entry.trainerName}'s ${evolution}` : evolution;

        if (deckCards.has(evolutionKey)) {
          const cardDisplayNames = Array.from(entry.originalNames).join(', ');
          warnings.push({
            type: 'ex_evolution_restriction',
            severity: 'warning',
            message: `${cardDisplayNames}: ex Pokemon cannot evolve. Remove ${evolution} ` +
                    `or use non-ex version of ${baseName}.`,
            cardName: cardKey,
            conflictingEvolution: evolution
          });
        }
      }
    }
  }

  return warnings;
}

/**
 * Check if a card is a Pokemon card
 * @param {object} card - Card object
 * @returns {boolean} True if card is a Pokemon
 */
function isPokemonCard(card) {
  // This would need to be adapted based on your card data structure
  // For now, assume any card without specific trainer/energy indicators is Pokemon
  const name = card.name || card.uid || '';

  // Skip obvious non-Pokemon cards
  const nonPokemonKeywords = [
    'Energy', 'Professor', 'Ball', 'Potion', 'Switch', 'Research', 'Orders',
    'Belt', 'Rod', 'Cape', 'Drum', 'Box', 'Aroma', 'Stamp', 'Laser',
    'Town', 'Stadium', 'Gym', 'Center', 'Temple', 'Lake', 'Mountain',
    'Training', 'Academy', 'Festival', 'Court'
  ];

  for (const keyword of nonPokemonKeywords) {
    if (name.includes(keyword)) {
      return false;
    }
  }

  return true;
}

/**
 * Get evolution validation summary for display
 * @param {Array} warnings - Validation warnings
 * @returns {object} Summary object with counts and categorized warnings
 */
export function getEvolutionValidationSummary(warnings) {
  const summary = {
    totalWarnings: warnings.length,
    errors: warnings.filter(w => w.severity === 'error'),
    warnings: warnings.filter(w => w.severity === 'warning'),
    byType: {}
  };

  for (const warning of warnings) {
    if (!summary.byType[warning.type]) {
      summary.byType[warning.type] = [];
    }
    summary.byType[warning.type].push(warning);
  }

  return summary;
}

/**
 * Format evolution validation warnings for display
 * @param {Array} warnings - Validation warnings
 * @returns {string} Formatted warnings text
 */
export function formatEvolutionWarnings(warnings) {
  if (warnings.length === 0) {
    return 'No evolution issues found.';
  }

  const summary = getEvolutionValidationSummary(warnings);
  const output = [];

  if (summary.errors.length > 0) {
    output.push(`❌ ${summary.errors.length} Evolution Error${summary.errors.length > 1 ? 's' : ''}:`);
    for (const error of summary.errors) {
      output.push(`  • ${error.message}`);
    }
    output.push('');
  }

  if (summary.warnings.length > 0) {
    output.push(`⚠️ ${summary.warnings.length} Evolution Warning${summary.warnings.length > 1 ? 's' : ''}:`);
    for (const warning of summary.warnings) {
      output.push(`  • ${warning.message}`);
    }
  }

  return output.join('\n');
}

// Export validation functions for testing
export {
  getBasePokemonName,
  getTrainerName,
  isExPokemon,
  isBabyPokemon,
  getPreEvolutions,
  getEvolutions,
  areNamedVariantsCompatible,
  EVOLUTION_CHAINS,
  BABY_POKEMON,
  EVOLUTION_EXCEPTIONS,
  EVOLUTION_BYPASS_CARDS
};
