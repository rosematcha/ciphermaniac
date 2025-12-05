/* eslint-disable id-length */
import { logger } from './logger.js';
import { SUCCESS_TAGS } from '../data/performanceTiers.js';

const DEFAULT_MIN_APPEARANCES = 3;

interface Deck {
    tournamentId?: string;
    tournamentName?: string;
    tournamentDate?: string;
    archetype?: string;
    successTags?: string[];
    cards?: Array<{ name?: string; set?: string; number?: string | number }>;
}

interface Tournament {
    id: string;
    name?: string;
    date: string;
    deckTotal?: number;
}

interface TournamentMeta {
    id: string;
    name?: string;
    date: string;
    deckTotal: number;
}

interface TimelineEntry {
    tournamentId: string;
    tournamentName: string;
    date: string | null;
    decks: number;
    success: Record<string, number>;
    totalDecks?: number;
    share?: number;
}

interface ArchetypeData {
    base: string;
    displayName: string;
    totalDecks: number;
    timeline: Map<string, TimelineEntry>;
}

interface ArchetypeSeries {
    base: string;
    displayName: string;
    totalDecks: number;
    appearances: number;
    avgShare: number;
    maxShare: number;
    minShare: number;
    successTotals: Record<string, number>;
    timeline: TimelineEntry[];
}

interface TrendDatasetOptions {
    now?: string | Date;
    minAppearances?: number;
    windowStart?: string | null;
    windowEnd?: string | null;
    successFilter?: string;
}

interface TrendDataset {
    generatedAt: string;
    windowStart: string | null;
    windowEnd: string | null;
    minAppearances: number;
    deckTotal: number;
    tournamentCount: number;
    archetypeCount: number;
    tournaments: TournamentMeta[];
    series: ArchetypeSeries[];
    successFilter?: string;
}

function normalizeArchetypeName(name: string | undefined): string {
    const cleaned = (name || '').replace(/_/g, ' ').trim();
    if (!cleaned) {
        return 'unknown';
    }
    return cleaned.replace(/\s+/g, ' ').toLowerCase();
}

function buildBaseName(normalized: string): string {
    return (normalized || 'unknown').replace(/ /g, '_').replace(/[^a-z0-9_]/g, '') || 'unknown';
}

/**
 *
 * @param decks
 * @param tournaments
 * @param options
 */
export function buildTrendDataset(decks: Deck[], tournaments: Tournament[], options: TrendDatasetOptions = {}): TrendDataset {
    const now = options.now ? new Date(options.now) : new Date();
    const minAppearances = Math.max(
        1,
        Number.isFinite(options.minAppearances) ? Number(options.minAppearances) : DEFAULT_MIN_APPEARANCES
    );
    const successFilter = options.successFilter || 'all';

    const sortedTournaments = (Array.isArray(tournaments) ? tournaments : [])
        .filter(t => t && t.id)
        .map(t => ({ ...t }))
        .sort((a, b) => Date.parse(a.date || '0') - Date.parse(b.date || '0'));

    const tournamentIndex = new Map<string, TournamentMeta>();
    sortedTournaments.forEach(t => {
        tournamentIndex.set(t.id, { id: t.id, name: t.name, date: t.date, deckTotal: 0 });
    });

    const archetypes = new Map<string, ArchetypeData>();
    const deckList = Array.isArray(decks) ? decks : [];
    const successTagSet = new Set<string>(SUCCESS_TAGS);

    // Helper to check if deck matches the performance filter
    const matchesFilter = (deckSuccessTags: string[] | undefined): boolean => {
        if (successFilter === 'all') return true;
        if (!Array.isArray(deckSuccessTags) || deckSuccessTags.length === 0) return false;
        return deckSuccessTags.includes(successFilter);
    };

    for (const deck of deckList) {
        const tournamentId = deck?.tournamentId;
        if (!tournamentId || !tournamentIndex.has(tournamentId)) {
            continue;
        }
        
        // Skip decks that don't match the performance filter
        if (!matchesFilter(deck?.successTags)) {
            continue;
        }

        const normalized = normalizeArchetypeName(deck?.archetype || 'Unknown');
        const base = buildBaseName(normalized);
        const displayName = deck?.archetype || 'Unknown';

        const archetype = archetypes.get(base) || {
            base,
            displayName,
            totalDecks: 0,
            timeline: new Map()
        };

        const tournamentMeta = tournamentIndex.get(tournamentId)!;
        tournamentMeta.deckTotal += 1;

        const entry = archetype.timeline.get(tournamentId) || {
            tournamentId,
            tournamentName: deck?.tournamentName || tournamentMeta?.name || 'Unknown Tournament',
            date: deck?.tournamentDate || tournamentMeta?.date || null,
            decks: 0,
            success: {}
        };

        entry.decks += 1;
        for (const tag of Array.isArray(deck?.successTags) ? deck.successTags : []) {
            if (!successTagSet.has(tag)) {
                continue;
            }
            entry.success[tag] = (entry.success[tag] || 0) + 1;
        }

        archetype.timeline.set(tournamentId, entry);
        archetype.totalDecks += 1;
        archetype.displayName = archetype.displayName || displayName;
        archetypes.set(base, archetype);
    }

    const series: ArchetypeSeries[] = [];
    archetypes.forEach(archetype => {
        const timeline = Array.from(archetype.timeline.values())
            .map(entry => {
                const tournamentMeta = tournamentIndex.get(entry.tournamentId);
                const totalDecks = tournamentMeta?.deckTotal || 0;
                const share = totalDecks ? Math.round((entry.decks / totalDecks) * 10000) / 100 : 0;
                return {
                    ...entry,
                    totalDecks,
                    share
                };
            })
            .sort((a, b) => Date.parse(a.date || '0') - Date.parse(b.date || '0'));

        if (timeline.length < minAppearances) {
            return;
        }

        const shares = timeline.map(item => item.share || 0);
        const successTotals: Record<string, number> = {};
        for (const entry of timeline) {
            Object.entries(entry.success || {}).forEach(([tag, count]) => {
                successTotals[tag] = (successTotals[tag] || 0) + (Number(count) || 0);
            });
        }

        const avgShare = shares.length
            ? Math.round((shares.reduce((sum, value) => sum + value, 0) / shares.length) * 10) / 10
            : 0;
        const maxShare = shares.length ? Math.max(...shares) : 0;
        const minShare = shares.length ? Math.min(...shares) : 0;

        series.push({
            base: archetype.base,
            displayName: archetype.displayName,
            totalDecks: archetype.totalDecks,
            appearances: timeline.length,
            avgShare,
            maxShare,
            minShare,
            successTotals,
            timeline
        });
    });

    series.sort((a, b) => b.totalDecks - a.totalDecks || b.avgShare - a.avgShare);

    const tournamentsWithTotals = sortedTournaments.map(t => ({
        id: t.id,
        name: t.name,
        date: t.date,
        deckTotal: tournamentIndex.get(t.id)?.deckTotal || 0
    }));

    // Count filtered decks (decks that matched the filter)
    const filteredDeckCount = Array.from(archetypes.values()).reduce((sum, a) => sum + a.totalDecks, 0);

    logger.debug('Built trend dataset', {
        deckTotal: filteredDeckCount,
        archetypes: series.length,
        tournaments: tournamentsWithTotals.length,
        successFilter
    });

    return {
        generatedAt: now.toISOString(),
        windowStart: options.windowStart || null,
        windowEnd: options.windowEnd || null,
        minAppearances,
        deckTotal: filteredDeckCount,
        tournamentCount: tournamentsWithTotals.length,
        archetypeCount: series.length,
        tournaments: tournamentsWithTotals,
        series,
        successFilter
    };
}

interface CardTrendEntry {
    tournamentId: string;
    date: string | null;
    present: number;
    total: number;
    share: number;
}

interface CardTrendSeries {
    key: string;
    name: string;
    set: string | null;
    number: string | null;
    appearances: number;
    startShare: number;
    endShare: number;
    delta: number;
    currentShare: number;
}

interface CardTrendDatasetOptions {
    now?: string | Date;
    minAppearances?: number;
    topCount?: number;
    windowStart?: string | null;
    windowEnd?: string | null;
}

interface CardTrendDataset {
    generatedAt: string;
    windowStart: string | null;
    windowEnd: string | null;
    cardsAnalyzed: number;
    minAppearances: number;
    topCount: number;
    rising: CardTrendSeries[];
    falling: CardTrendSeries[];
}

/**
 *
 * @param decks
 * @param tournaments
 * @param options
 */
export function buildCardTrendDataset(decks: Deck[], tournaments: Tournament[], options: CardTrendDatasetOptions = {}): CardTrendDataset {
    const now = options.now ? new Date(options.now) : new Date();
    const minAppearances = Math.max(1, Number.isFinite(options.minAppearances) ? options.minAppearances! : 2);
    const topCount = Math.max(1, Number.isFinite(options.topCount) ? options.topCount! : 12);

    const tournamentsMap = new Map<string, { id: string; date: string | null; deckTotal: number }>();
    (Array.isArray(tournaments) ? tournaments : []).forEach(t => {
        if (t && t.id) {
            tournamentsMap.set(t.id, {
                id: t.id,
                date: t.date || null,
                deckTotal: Number(t.deckTotal) || 0
            });
        }
    });

    const cardPresence = new Map<string, Map<string, number>>();
    const cardMeta = new Map<string, { name: string; set: string | null; number: string | null }>();
    const deckList = Array.isArray(decks) ? decks : [];

    for (const deck of deckList) {
        const tournamentId = deck?.tournamentId;
        if (!tournamentId || !tournamentsMap.has(tournamentId)) {
            continue;
        }
        const unique = new Set<string>();
        for (const card of Array.isArray(deck?.cards) ? deck.cards : []) {
            const name = card?.name || 'Unknown Card';
            const set = (card?.set || '').toString().toUpperCase();
            const number = card?.number || '';
            const key = set && number ? `${name}::${set}::${number}` : name;
            unique.add(key);
            if (!cardMeta.has(key)) {
                cardMeta.set(key, { name, set: set || null, number: number.toString() || null });
            }
        }
        unique.forEach(key => {
            if (!cardPresence.has(key)) {
                cardPresence.set(key, new Map());
            }
            const counts = cardPresence.get(key)!;
            counts.set(tournamentId, (counts.get(tournamentId) || 0) + 1);
        });
    }

    const series: CardTrendSeries[] = [];
    cardPresence.forEach((presenceMap, key) => {
        const timeline: CardTrendEntry[] = Array.from(tournamentsMap.values())
            .sort((a, b) => Date.parse(a.date || '0') - Date.parse(b.date || '0'))
            .map(meta => {
                const present = presenceMap.get(meta.id) || 0;
                const share = meta.deckTotal ? Math.round((present / meta.deckTotal) * 10000) / 100 : 0;
                return {
                    tournamentId: meta.id,
                    date: meta.date || null,
                    present,
                    total: meta.deckTotal,
                    share
                };
            });

        const presentEvents = timeline.filter(entry => entry.present > 0).length;
        if (presentEvents < minAppearances) {
            return;
        }

        const chunk = Math.max(1, Math.ceil(timeline.length / 3));
        const startAvg =
            Math.round((timeline.slice(0, chunk).reduce((sum, entry) => sum + (entry.share || 0), 0) / chunk) * 10) / 10;
        const endAvg =
            Math.round((timeline.slice(-chunk).reduce((sum, entry) => sum + (entry.share || 0), 0) / chunk) * 10) / 10;
        const delta = Math.round((endAvg - startAvg) * 10) / 10;
        const latestShare = timeline.at(-1)?.share || 0;

        const meta = cardMeta.get(key)!;
        series.push({
            key,
            name: meta.name,
            set: meta.set,
            number: meta.number,
            appearances: timeline.length,
            startShare: startAvg,
            endShare: endAvg,
            delta,
            currentShare: latestShare
        });
    });

    const rising = [...series].sort((a, b) => b.delta - a.delta).slice(0, topCount);
    const falling = [...series].sort((a, b) => a.delta - b.delta).slice(0, topCount);

    logger.debug('Built card trend dataset', {
        cards: series.length,
        rising: rising.length,
        falling: falling.length
    });

    return {
        generatedAt: now.toISOString(),
        windowStart: options.windowStart || null,
        windowEnd: options.windowEnd || null,
        cardsAnalyzed: series.length,
        minAppearances,
        topCount,
        rising,
        falling
    };
}
