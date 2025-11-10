const INVALID_PATH_CHARS = /[<>:"/\\|?*]/g;

function composeDisplayCategory(category, trainerType, energyType) {
  const base = (category || '').toLowerCase();
  if (!base) {
    return '';
  }
  if (base === 'trainer' && trainerType) {
    return `trainer-${trainerType.toLowerCase()}`;
  }
  if (base === 'energy' && energyType) {
    return `energy-${energyType.toLowerCase()}`;
  }
  return base;
}

function sanitizeForPath(text) {
  const value = typeof text === 'string' ? text : String(text || '');
  return value.replace(INVALID_PATH_CHARS, '').trim();
}

function sanitizeForFilename(text) {
  return sanitizeForPath((text || '').toString().replace(/ /g, '_'));
}

function normalizeArchetypeName(name) {
  const cleaned = (name || '').replace(/_/g, ' ').trim();
  if (!cleaned) {
    return 'unknown';
  }
  return cleaned
    .split(/\s+/)
    .sort((a, b) => a.localeCompare(b))
    .join(' ');
}

function normalizeCardNumber(value) {
  if (value === undefined || value === null) {
    return '';
  }
  const raw = String(value).trim();
  if (!raw) {
    return '';
  }
  const match = /^(\d+)([A-Za-z]*)$/.exec(raw);
  if (!match) {
    return raw.toUpperCase();
  }
  const [, digits, suffix = ''] = match;
  const normalized = digits.padStart(3, '0');
  return suffix ? `${normalized}${suffix.toUpperCase()}` : normalized;
}

function canonicalizeVariant(setCode, number) {
  const sc = (setCode || '').toString().toUpperCase().trim();
  if (!sc) {
    return [null, null];
  }
  const normalizedNumber = normalizeCardNumber(number);
  if (!normalizedNumber) {
    return [sc, null];
  }
  return [sc, normalizedNumber];
}

function createDistribution(counts, found) {
  const counter = new Map();
  counts.forEach(value => {
    const key = Number(value) || 0;
    counter.set(key, (counter.get(key) || 0) + 1);
  });

  return Array.from(counter.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([copies, players]) => ({
      copies,
      players,
      percent: found ? Math.round(((players / found) * 100 + Number.EPSILON) * 100) / 100 : 0
    }));
}

function generateReportFromDecks(deckList, deckTotal) {
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
      const displayCategory =
        card?.displayCategory ||
        composeDisplayCategory(category, trainerType, energyType) ||
        undefined;

      const [canonSet, canonNumber] = canonicalizeVariant(card?.set, card?.number);
      const uid = canonSet && canonNumber ? `${name}::${canonSet}::${canonNumber}` : name;

      perDeckCounts.set(uid, (perDeckCounts.get(uid) || 0) + count);
      perDeckMeta.set(uid, {
        set: canonSet || undefined,
        number: canonNumber || undefined,
        category: category || undefined,
        trainerType: trainerType || undefined,
        energyType: energyType || undefined,
        displayCategory
      });

      if (!nameCasing.has(uid)) {
        nameCasing.set(uid, name);
      }
      if ((category || trainerType || energyType || displayCategory) && !uidCategory.has(uid)) {
        uidCategory.set(uid, {
          category: category || undefined,
          trainerType: trainerType || undefined,
          energyType: energyType || undefined,
          displayCategory
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
    (a, b) => cardData.get(b).length - cardData.get(a).length
  );

  const items = sortedKeys.map((uid, index) => {
    const countsList = cardData.get(uid) || [];
    const foundCount = countsList.length;
    const item = {
      rank: index + 1,
      name: nameCasing.get(uid) || uid,
      found: foundCount,
      total: deckTotal,
      pct: deckTotal
        ? Math.round(((foundCount / deckTotal) * 100 + Number.EPSILON) * 100) / 100
        : 0,
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
      if (categoryInfo.category) {
        item.category = categoryInfo.category;
      }
      if (categoryInfo.trainerType) {
        item.trainerType = categoryInfo.trainerType;
      }
      if (categoryInfo.energyType) {
        item.energyType = categoryInfo.energyType;
      }
      const displayCategory =
        categoryInfo.displayCategory ||
        composeDisplayCategory(
          categoryInfo.category,
          categoryInfo.trainerType,
          categoryInfo.energyType
        );
      if (displayCategory) {
        item.displayCategory = displayCategory;
      }
    }

    return item;
  });

  return {
    deckTotal,
    items
  };
}

export {
  composeDisplayCategory,
  sanitizeForFilename,
  sanitizeForPath,
  normalizeArchetypeName,
  generateReportFromDecks
};
