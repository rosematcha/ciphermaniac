/**
 * Utilities to aggregate tournament decklists into binder-friendly groupings.
 * @module tools/metaBinderData
 */
import { logger } from '../utils/logger.js';
const MIN_DECKS_PER_EVENT = 4;
const HIGH_USAGE_RATIO = 0.6;
const MODERATE_USAGE_RATIO = 0.35;
const STAPLE_POKEMON_MIN_ARCHETYPES = 3;
const ARCHETYPE_CORE_RATIO = 0.35;
const SUPPORTER_FREQUENT_GLOBAL_RATE = 0.25;
const SUPPORTER_HIGH_USAGE_ARCH_MIN = 2;
const ITEM_FREQUENT_GLOBAL_RATE = 0.2;
const ITEM_MOD_USAGE_ARCH_MIN = 2;
const CROSS_ARCH_MIN_DECK_SHARE = 0.22;
const CROSS_ARCH_SECONDARY_RATIO = 0.35;
const ARCHETYPE_PREFIX_ALIASES = [
    { prefix: 'gardevoir', canonical: 'Gardevoir' },
    { prefix: 'dragapult', canonical: 'Dragapult' },
    { prefix: 'charizard', canonical: 'Charizard' },
    { prefix: 'gholdengo', canonical: 'Gholdengo' },
    { prefix: 'miraidon', canonical: 'Miraidon' },
    { prefix: 'ns_zoroark', canonical: "N's Zoroark" }
];
const ACE_SPEC_KEYWORDS = [
    'ace spec',
    'prime catcher',
    'reboot pod',
    'legacy energy',
    'enriching energy',
    'neo upper energy',
    'master ball',
    'secret box',
    'sparkling crystal',
    "hero's cape",
    "hero's cape",
    'scramble switch',
    'dowsing machine',
    'computer search',
    'life dew',
    'scoop up cyclone',
    'gold potion',
    'victory piece',
    'g booster',
    'g scope',
    'g spirit',
    'crystal edge',
    'crystal wall',
    'rock guard',
    'surprise megaphone',
    'chaotic amplifier',
    'precious trolley',
    'poke vital a',
    'unfair stamp',
    'brilliant blender'
].map(keyword => keyword.toLowerCase());
function normalizeWhitespace(value) {
    return String(value ?? '')
        .replace(/\s+/g, ' ')
        .trim();
}
function formatArchetypeName(rawName) {
    const name = normalizeWhitespace(rawName);
    if (!name) {
        return 'Unknown';
    }
    return name.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}
function canonicalizeArchetype(rawName) {
    const normalized = normalizeWhitespace(rawName || 'Unknown');
    const underscored = normalized.replace(/\s+/g, '_').toLowerCase();
    for (const { prefix, canonical } of ARCHETYPE_PREFIX_ALIASES) {
        if (underscored.startsWith(prefix)) {
            return canonical;
        }
    }
    return formatArchetypeName(underscored);
}
function normalizeCardKey(name) {
    return normalizeWhitespace(name).toLowerCase();
}
function isAceSpec(name, trainerType) {
    if ((trainerType || '').toLowerCase() === 'ace-spec') {
        return true;
    }
    const normalized = normalizeCardKey(name);
    return ACE_SPEC_KEYWORDS.some(keyword => normalized.includes(keyword));
}
function ensureMapEntry(map, key, factory) {
    let entry = map.get(key);
    if (!entry) {
        entry = factory();
        map.set(key, entry);
    }
    return entry;
}
function createCardAccumulator(card) {
    return {
        name: card.name,
        category: card.category || null,
        trainerType: card.trainerType || null,
        energyType: card.energyType || null,
        variants: new Map(),
        maxCopies: 0,
        totalDecksWithCard: 0,
        perArchetype: new Map(),
        perTournament: new Map()
    };
}
/**
 * Analyse events and normalise archetype naming.
 * @param {Array<{ tournament: string, decks: DeckRecord[] }>} events
 * @returns {AnalyzedEvents}
 */
export function analyzeEvents(events = []) {
    const processed = [];
    const archetypeStats = new Map();
    let totalDecks = 0;
    for (const event of events) {
        if (!event || !Array.isArray(event.decks)) {
            continue;
        }
        const enrichedDecks = [];
        for (const deck of event.decks) {
            if (!deck || !Array.isArray(deck.cards)) {
                continue;
            }
            const canonical = canonicalizeArchetype(deck.archetype);
            const displayName = formatArchetypeName(canonical);
            const stats = ensureMapEntry(archetypeStats, canonical, () => ({
                canonical,
                displayName,
                deckCount: 0,
                originalNames: new Set()
            }));
            stats.deckCount += 1;
            if (deck.archetype) {
                stats.originalNames.add(deck.archetype);
            }
            enrichedDecks.push({
                ...deck,
                canonicalArchetype: canonical
            });
            totalDecks += 1;
        }
        processed.push({
            tournament: event.tournament || 'Unknown Event',
            decks: enrichedDecks
        });
    }
    logger.debug('metaBinder: analysed events', {
        eventCount: processed.length,
        totalDecks
    });
    return { events: processed, archetypeStats };
}
function pickPrimaryVariant(entry) {
    if (!entry.variants.size) {
        return { set: null, number: null };
    }
    let selected = null;
    for (const variant of entry.variants.values()) {
        if (!selected || variant.decks > selected.decks) {
            selected = variant;
        }
    }
    return {
        set: selected?.set ?? null,
        number: selected?.number ?? null
    };
}
function deriveUsageByArchetype(entry, archetypeDeckCounts) {
    const usage = [];
    for (const [archetype, data] of entry.perArchetype.entries()) {
        const totalDecks = archetypeDeckCounts.get(archetype) || 0;
        if (!totalDecks) {
            continue;
        }
        usage.push({
            archetype,
            displayName: formatArchetypeName(archetype),
            decks: data.decks,
            totalDecks,
            ratio: data.decks / totalDecks,
            maxCopies: data.maxCopies
        });
    }
    return usage.sort((first, second) => {
        if (second.ratio !== first.ratio) {
            return second.ratio - first.ratio;
        }
        if (second.decks !== first.decks) {
            return second.decks - first.decks;
        }
        return first.displayName.localeCompare(second.displayName);
    });
}
function deriveUsageByTournament(entry) {
    const usage = [];
    for (const [tournament, data] of entry.perTournament.entries()) {
        usage.push({ tournament, decks: data.decks });
    }
    return usage.sort((first, second) => second.decks - first.decks);
}
function isCrossArchetypeStaple(card, deckShare) {
    if (deckShare < CROSS_ARCH_MIN_DECK_SHARE) {
        return false;
    }
    const qualifying = card.usageByArchetype.filter(item => item.ratio >= HIGH_USAGE_RATIO);
    if (qualifying.length < STAPLE_POKEMON_MIN_ARCHETYPES) {
        return false;
    }
    const secondaryRatio = card.usageByArchetype[1]?.ratio ?? 0;
    return secondaryRatio >= CROSS_ARCH_SECONDARY_RATIO || qualifying.length >= 4;
}
const sortByPriority = (first, second) => {
    const copyDiff = (second.maxCopies || 0) - (first.maxCopies || 0);
    if (copyDiff !== 0) {
        return copyDiff;
    }
    const shareDiff = (second.deckShare || 0) - (first.deckShare || 0);
    if (shareDiff !== 0) {
        return shareDiff;
    }
    const totalDiff = (second.totalDecksWithCard || 0) - (first.totalDecksWithCard || 0);
    if (totalDiff !== 0) {
        return totalDiff;
    }
    return first.name.localeCompare(second.name);
};
function sortArchetypeCards(archetype) {
    return (first, second) => {
        const copyDiff = (second.maxCopies || 0) - (first.maxCopies || 0);
        if (copyDiff !== 0) {
            return copyDiff;
        }
        const firstUsage = first.usageByArchetype.find(item => item.archetype === archetype);
        const secondUsage = second.usageByArchetype.find(item => item.archetype === archetype);
        const ratioDiff = (secondUsage?.ratio || 0) - (firstUsage?.ratio || 0);
        if (ratioDiff !== 0) {
            return ratioDiff;
        }
        const deckDiff = (secondUsage?.decks || 0) - (firstUsage?.decks || 0);
        if (deckDiff !== 0) {
            return deckDiff;
        }
        return first.name.localeCompare(second.name);
    };
}
/**
 * Build binder dataset from analysed events.
 * @param {AnalyzedEvents} analysis
 * @param {Set<string>|null|undefined} includedArchetypes
 * @returns {BinderDataset}
 */
export function buildBinderDataset(analysis, includedArchetypes) {
    const allowedArchetypes = includedArchetypes instanceof Set ? includedArchetypes : null;
    const cardMap = new Map();
    const archetypeDeckCounts = new Map();
    const tournamentsIncluded = new Set();
    let totalDecks = 0;
    for (const event of analysis.events) {
        if (!event.decks || event.decks.length === 0) {
            continue;
        }
        tournamentsIncluded.add(event.tournament);
        for (const deck of event.decks) {
            const archetype = deck.canonicalArchetype;
            if (allowedArchetypes && !allowedArchetypes.has(archetype)) {
                continue;
            }
            archetypeDeckCounts.set(archetype, (archetypeDeckCounts.get(archetype) || 0) + 1);
            totalDecks += 1;
            for (const card of deck.cards) {
                if (!card || !card.name) {
                    continue;
                }
                const key = normalizeCardKey(card.name);
                const accumulator = ensureMapEntry(cardMap, key, () => createCardAccumulator(card));
                accumulator.name = accumulator.name || card.name;
                accumulator.category = accumulator.category || card.category || null;
                accumulator.trainerType = accumulator.trainerType || card.trainerType || null;
                accumulator.energyType = accumulator.energyType || card.energyType || null;
                accumulator.totalDecksWithCard += 1;
                accumulator.maxCopies = Math.max(accumulator.maxCopies, Number(card.count) || 0);
                const setCode = card.set ? String(card.set).toUpperCase() : null;
                const numberCode = card.number ? String(card.number).toUpperCase() : null;
                if (setCode && numberCode) {
                    const variantKey = `${setCode}::${numberCode}`;
                    const variant = ensureMapEntry(accumulator.variants, variantKey, () => ({
                        set: setCode,
                        number: numberCode,
                        decks: 0
                    }));
                    variant.decks += 1;
                }
                const archetypeUsage = ensureMapEntry(accumulator.perArchetype, archetype, () => ({
                    decks: 0,
                    maxCopies: 0
                }));
                archetypeUsage.decks += 1;
                archetypeUsage.maxCopies = Math.max(archetypeUsage.maxCopies, Number(card.count) || 0);
                const tournamentUsage = ensureMapEntry(accumulator.perTournament, event.tournament, () => ({ decks: 0 }));
                tournamentUsage.decks += 1;
            }
        }
    }
    const totalDecksAll = analysis.events.reduce((sum, event) => sum + (event.decks?.length || 0), 0);
    if (!totalDecks) {
        return {
            meta: {
                totalDecks: 0,
                allDecks: totalDecksAll,
                tournaments: Array.from(tournamentsIncluded),
                archetypeStats: []
            },
            sections: {
                aceSpecs: [],
                staplePokemon: [],
                archetypePokemon: [],
                frequentSupporters: [],
                nicheSupporters: [],
                stadiums: [],
                tools: [],
                frequentItems: [],
                nicheItems: [],
                specialEnergy: [],
                basicEnergy: []
            }
        };
    }
    const aceSpecs = [];
    const staplePokemon = [];
    const archetypePokemonMap = new Map();
    const frequentSupporters = [];
    const nicheSupporters = [];
    const stadiums = [];
    const tools = [];
    const frequentItems = [];
    const nicheItems = [];
    const specialEnergy = [];
    const basicEnergy = [];
    const placedIds = new Set();
    const placeCard = (card, target) => {
        if (placedIds.has(card.id)) {
            return false;
        }
        target.push(card);
        placedIds.add(card.id);
        return true;
    };
    for (const entry of cardMap.values()) {
        const usageByArchetype = deriveUsageByArchetype(entry, archetypeDeckCounts);
        const usageByTournament = deriveUsageByTournament(entry);
        const qualifiesOnEvent = usageByTournament.some(usage => usage.decks >= MIN_DECKS_PER_EVENT);
        if (!qualifiesOnEvent) {
            continue;
        }
        const variant = pickPrimaryVariant(entry);
        const setCode = variant.set ? String(variant.set).toUpperCase() : null;
        const numberCode = variant.number ? String(variant.number).toUpperCase() : null;
        const priceKey = setCode && numberCode ? `${entry.name}::${setCode}::${numberCode}` : null;
        const deckShare = entry.totalDecksWithCard / totalDecks;
        const card = /** @type {BinderCard} */ {
            id: normalizeCardKey(entry.name),
            name: entry.name,
            set: setCode,
            number: numberCode,
            priceKey,
            category: entry.category,
            trainerType: entry.trainerType,
            energyType: entry.energyType,
            maxCopies: entry.maxCopies || 0,
            totalDecksWithCard: entry.totalDecksWithCard,
            deckShare,
            usageByArchetype,
            usageByTournament,
            highUsageArchetypes: usageByArchetype.filter(usage => usage.ratio >= HIGH_USAGE_RATIO).length,
            moderateUsageArchetypes: usageByArchetype.filter(usage => usage.ratio >= MODERATE_USAGE_RATIO).length
        };
        if (isAceSpec(card.name, card.trainerType)) {
            placeCard(card, aceSpecs);
            continue;
        }
        if (getBaseCategory(card.category) === 'pokemon') {
            if (isCrossArchetypeStaple(card, deckShare)) {
                placeCard(card, staplePokemon);
                continue;
            }
            if (placedIds.has(card.id)) {
                continue;
            }
            // Include in any archetype where it appears in at least 50% of decks
            let addedToArchetype = false;
            for (const usage of usageByArchetype) {
                if (usage.ratio >= ARCHETYPE_CORE_RATIO) {
                    const list = ensureMapEntry(archetypePokemonMap, usage.archetype, () => []);
                    list.push(card);
                    addedToArchetype = true;
                }
            }
            if (addedToArchetype) {
                placedIds.add(card.id);
            }
            continue;
        }
        if (getBaseCategory(card.category) === 'trainer') {
            if (card.trainerType === 'supporter') {
                if (deckShare >= SUPPORTER_FREQUENT_GLOBAL_RATE || card.highUsageArchetypes >= SUPPORTER_HIGH_USAGE_ARCH_MIN) {
                    placeCard(card, frequentSupporters);
                }
                else {
                    placeCard(card, nicheSupporters);
                }
                continue;
            }
            if (card.trainerType === 'stadium') {
                placeCard(card, stadiums);
                continue;
            }
            if (card.trainerType === 'tool') {
                placeCard(card, tools);
                continue;
            }
            if (card.trainerType === 'item') {
                if (deckShare >= ITEM_FREQUENT_GLOBAL_RATE || card.moderateUsageArchetypes >= ITEM_MOD_USAGE_ARCH_MIN) {
                    placeCard(card, frequentItems);
                }
                else {
                    placeCard(card, nicheItems);
                }
                continue;
            }
        }
        if (getBaseCategory(card.category) === 'energy') {
            if (card.energyType === 'special') {
                placeCard(card, specialEnergy);
            }
            else {
                placeCard(card, basicEnergy);
            }
        }
    }
    for (const [archetype, cards] of archetypePokemonMap.entries()) {
        cards.sort(sortArchetypeCards(archetype));
        if (!cards.length) {
            archetypePokemonMap.delete(archetype);
        }
    }
    const archetypePokemon = Array.from(archetypePokemonMap.entries())
        .map(([canonical, cards]) => ({
        canonical,
        displayName: formatArchetypeName(canonical),
        cards
    }))
        .sort((first, second) => {
        const firstDecks = archetypeDeckCounts.get(first.canonical) || 0;
        const secondDecks = archetypeDeckCounts.get(second.canonical) || 0;
        if (secondDecks !== firstDecks) {
            return secondDecks - firstDecks;
        }
        return first.displayName.localeCompare(second.displayName);
    });
    aceSpecs.sort(sortByPriority);
    staplePokemon.sort(sortByPriority);
    frequentSupporters.sort(sortByPriority);
    nicheSupporters.sort(sortByPriority);
    stadiums.sort(sortByPriority);
    tools.sort(sortByPriority);
    frequentItems.sort(sortByPriority);
    nicheItems.sort(sortByPriority);
    specialEnergy.sort(sortByPriority);
    basicEnergy.sort(sortByPriority);
    const archetypeStats = Array.from(analysis.archetypeStats.values())
        .map(entry => ({
        canonical: entry.canonical,
        displayName: entry.displayName,
        deckCount: entry.deckCount,
        originalNames: Array.from(entry.originalNames).sort()
    }))
        .sort((first, second) => {
        if (second.deckCount !== first.deckCount) {
            return second.deckCount - first.deckCount;
        }
        return first.displayName.localeCompare(second.displayName);
    });
    return {
        meta: {
            totalDecks,
            allDecks: totalDecksAll,
            tournaments: Array.from(tournamentsIncluded),
            archetypeStats
        },
        sections: {
            aceSpecs,
            staplePokemon,
            archetypePokemon,
            frequentSupporters,
            nicheSupporters,
            stadiums,
            tools,
            frequentItems,
            nicheItems,
            specialEnergy,
            basicEnergy
        }
    };
}
export const thresholds = {
    MIN_DECKS_PER_EVENT,
    HIGH_USAGE_RATIO,
    MODERATE_USAGE_RATIO,
    STAPLE_POKEMON_MIN_ARCHETYPES,
    ARCHETYPE_CORE_RATIO
};
function getBaseCategory(category) {
    const slug = typeof category === 'string' ? category.toLowerCase() : '';
    return slug.split('/')[0] || '';
}
