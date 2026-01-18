import { inferPrimaryCategory } from '../cardCategories.js';
import { formatTcgliveCardNumber } from '../utils/format.js';
import type { CardItemData, SkeletonExportEntry } from '../types.js';

/**
 * Resolve the set and number needed for TCG Live exports.
 * @param card - Card item data.
 */
export function resolveCardPrintInfo(card: CardItemData): { set: string; number: string } {
  let setCode = typeof card?.set === 'string' ? card.set.trim().toUpperCase() : '';
  let numberValue = typeof card?.number === 'string' || typeof card?.number === 'number' ? card.number : '';

  if ((!setCode || !numberValue) && typeof card?.uid === 'string') {
    const segments = card.uid.split('::');
    if (segments.length >= 3) {
      if (!setCode) {
        setCode = segments[1].trim().toUpperCase();
      }
      if (!numberValue) {
        numberValue = segments[2].trim();
      }
    }
  }

  return {
    set: setCode,
    number: formatTcgliveCardNumber(numberValue)
  };
}

/**
 * Pick the most common distribution entry for a card.
 * @param card - Card item data.
 */
export function pickCommonDistEntry(
  card: CardItemData
): { copies?: number; players?: number; percent?: number } | null {
  if (!card || !Array.isArray(card.dist) || card.dist.length === 0) {
    return null;
  }

  type DistEntry = NonNullable<CardItemData['dist']>[number];

  return card.dist.reduce<DistEntry | null>((best, candidate) => {
    if (!candidate) {
      return best;
    }
    if (!best) {
      return candidate;
    }

    const bestPercent = Number(best.percent) || 0;
    const candidatePercent = Number(candidate.percent) || 0;
    if (candidatePercent !== bestPercent) {
      return candidatePercent > bestPercent ? candidate : best;
    }

    const bestPlayers = Number(best.players) || 0;
    const candidatePlayers = Number(candidate.players) || 0;
    if (candidatePlayers !== bestPlayers) {
      return candidatePlayers > bestPlayers ? candidate : best;
    }

    const bestCopies = Number(best.copies) || 0;
    const candidateCopies = Number(candidate.copies) || 0;
    if (candidateCopies !== bestCopies) {
      return candidateCopies > bestCopies ? candidate : best;
    }

    return best;
  }, null);
}

/**
 * Build export entries for the skeleton deck list.
 * @param items - Card items to convert.
 */
export function buildSkeletonExportEntries(items: CardItemData[]): SkeletonExportEntry[] {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.reduce<SkeletonExportEntry[]>((entries, item) => {
    const mostCommon = pickCommonDistEntry(item);
    const copies = Number(mostCommon?.copies) || 0;
    if (copies <= 0) {
      return entries;
    }

    const name = typeof item?.name === 'string' ? item.name.trim() : '';
    if (!name) {
      return entries;
    }

    const printInfo = resolveCardPrintInfo(item);
    const primaryCategory = inferPrimaryCategory(item);
    const normalizedCategory = ['pokemon', 'trainer', 'energy'].includes(primaryCategory)
      ? primaryCategory
      : 'pokemon';

    entries.push({
      name,
      copies,
      set: printInfo.set,
      number: printInfo.number,
      primaryCategory: normalizedCategory
    });
    return entries;
  }, []);
}
