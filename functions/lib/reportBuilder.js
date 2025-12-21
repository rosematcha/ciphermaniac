import { getCanonicalCard } from './cardSynonyms.js';
import { canonicalizeVariant, sanitizeForFilename, sanitizeForPath } from './cardUtils.js';

function composeCategoryPath(category, trainerType, energyType, options = {}) {
  const base = (category || '').toLowerCase();
  if (!base) {
    return '';
  }

  const parts = [base];
  if (base === 'trainer') {
    if (trainerType) {
      parts.push(trainerType.toLowerCase());
    }
    if (options.aceSpec) {
      if (!parts.includes('tool') && (!trainerType || trainerType.toLowerCase() !== 'tool')) {
        parts.push('tool');
      }
      parts.push('acespec');
    }
  } else if (base === 'energy' && energyType) {
    parts.push(energyType.toLowerCase());
  }

  return parts.join('/');
}

function normalizeArchetypeName(name) {
  const cleaned = (name || '').replace(/_/g, ' ').trim();
  if (!cleaned) {
    return 'unknown';
  }
  return cleaned.replace(/\s+/g, ' ').toLowerCase();
}

function createDistribution(counts, found) {
  const counter = new Map();
  counts.forEach(value => {
    const key = Number(value) || 0;
    counter.set(key, (counter.get(key) || 0) + 1);
  });

  return Array.from(counter.entries())
    .sort((first, second) => first[0] - second[0])
    .map(([copies, players]) => ({
      copies,
      players,
      percent: found ? Math.round(((players / found) * 100 + Number.EPSILON) * 100) / 100 : 0
    }));
}

function generateReportFromDecks(deckList, deckTotal, _unused, synonymDb) {
  const cardData = new Map();
  const nameCasing = new Map();
  const uidMeta = new Map();
  const uidCategory = new Map();

  const decks = Array.isArray(deckList) ? deckList : [];

  for (const deck of decks) {
    const perDeckCounts = new Map();
    const perDeckMeta = new Map();
    const cards = Array.isArray(deck?.cards) ? deck.cards : [];

    for (const card of cards) {
      const count = Number(card?.count) || 0;
      if (!count) {
        continue;
      }
      const name = card?.name || 'Unknown Card';
      const category = card?.category || null;
      const trainerType = card?.trainerType || null;
      const energyType = card?.energyType || null;
      const aceSpec = Boolean(card?.aceSpec);

      const [canonSet, canonNumber] = canonicalizeVariant(card?.set, card?.number);
      let uid = canonSet && canonNumber ? `${name}::${canonSet}::${canonNumber}` : name;

      // Resolve to canonical synonym if database is available
      if (synonymDb) {
        uid = getCanonicalCard(synonymDb, uid);
      }

      perDeckCounts.set(uid, (perDeckCounts.get(uid) || 0) + count);
      perDeckMeta.set(uid, {
        set: canonSet || undefined,
        number: canonNumber || undefined,
        category: category || undefined,
        trainerType: trainerType || undefined,
        energyType: energyType || undefined,
        aceSpec: aceSpec || undefined
      });

      if (!nameCasing.has(uid)) {
        nameCasing.set(uid, name);
      }
      if ((category || trainerType || energyType || aceSpec) && !uidCategory.has(uid)) {
        uidCategory.set(uid, {
          category: category || undefined,
          trainerType: trainerType || undefined,
          energyType: energyType || undefined,
          aceSpec: aceSpec || undefined
        });
      }
    }

    perDeckCounts.forEach((totalCopies, uid) => {
      if (!cardData.has(uid)) {
        cardData.set(uid, []);
      }
      cardData.get(uid).push(totalCopies);

      if (!uidMeta.has(uid)) {
        uidMeta.set(uid, perDeckMeta.get(uid));
      }
    });
  }

  const sortedKeys = Array.from(cardData.keys()).sort(
    (first, second) => cardData.get(second).length - cardData.get(first).length
  );

  const items = sortedKeys.map((uid, index) => {
    const countsList = cardData.get(uid) || [];
    const foundCount = countsList.length;
    // Sanitize the name to prevent path traversal in reports
    const rawName = nameCasing.get(uid) || uid;
    const safeName = sanitizeForPath(rawName);
    const item = {
      rank: index + 1,
      name: safeName,
      found: foundCount,
      total: deckTotal,
      pct: deckTotal ? Math.round(((foundCount / deckTotal) * 100 + Number.EPSILON) * 100) / 100 : 0,
      dist: createDistribution(countsList, foundCount)
    };

    if (uid.includes('::')) {
      const meta = uidMeta.get(uid);
      if (meta?.set) {
        item.set = meta.set;
      }
      if (meta?.number) {
        item.number = meta.number;
      }
      item.uid = uid;
    }

    const categoryInfo = uidCategory.get(uid) || uidMeta.get(uid);
    if (categoryInfo) {
      if (categoryInfo.trainerType) {
        item.trainerType = categoryInfo.trainerType;
      }
      if (categoryInfo.energyType) {
        item.energyType = categoryInfo.energyType;
      }
      if (categoryInfo.aceSpec) {
        item.aceSpec = true;
      }
      const categorySlug = composeCategoryPath(
        categoryInfo.category,
        categoryInfo.trainerType,
        categoryInfo.energyType,
        { aceSpec: Boolean(categoryInfo.aceSpec) }
      );
      if (categorySlug) {
        item.category = categorySlug;
      } else if (categoryInfo.category) {
        item.category = categoryInfo.category;
      }
    }

    return item;
  });

  return {
    deckTotal,
    items
  };
}

export { composeCategoryPath, sanitizeForFilename, sanitizeForPath, normalizeArchetypeName, generateReportFromDecks };
