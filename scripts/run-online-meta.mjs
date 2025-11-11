#!/usr/bin/env node

import crypto from 'node:crypto';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

const LIMITLESS_API_BASE = 'https://play.limitlesstcg.com/api';
const WINDOW_DAYS = 14;
const TARGET_FOLDER = 'Online - Last 14 Days';
const PAGE_SIZE = 100;
const MAX_PAGES = 15;
const SUPPORTED_FORMATS = new Set(['STANDARD']);

function env(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

const LIMITLESS_API_KEY = env('LIMITLESS_API_KEY');
const R2_ACCOUNT_ID = env('R2_ACCOUNT_ID');
const R2_ACCESS_KEY_ID = env('R2_ACCESS_KEY_ID');
const R2_SECRET_ACCESS_KEY = env('R2_SECRET_ACCESS_KEY');
const R2_BUCKET_NAME = env('R2_BUCKET_NAME');
const R2_REPORTS_PREFIX = process.env.R2_REPORTS_PREFIX || 'reports';

const s3Client = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY
  }
});

function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function buildLimitlessUrl(path, params = {}) {
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
  const base = LIMITLESS_API_BASE.endsWith('/') ? LIMITLESS_API_BASE : `${LIMITLESS_API_BASE}/`;
  const url = new URL(normalizedPath, base);
  url.searchParams.set('key', LIMITLESS_API_KEY);
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      return;
    }
    url.searchParams.set(key, String(value));
  });
  return url;
}

async function fetchLimitless(path, params) {
  const url = buildLimitlessUrl(path, params);
  const response = await fetch(url, {
    headers: {
      'X-Access-Key': LIMITLESS_API_KEY,
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Limitless request failed (${response.status}): ${text.slice(0, 200)}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await response.text();
    throw new Error(`Unexpected response type (${contentType}): ${text.slice(0, 200)}`);
  }

  return response.json();
}

async function fetchRecentOnlineTournaments(since) {
  const sinceMs = since.getTime();
  const found = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const list = await fetchLimitless('/tournaments', {
      game: 'PTCG',
      limit: PAGE_SIZE,
      page
    });

    if (!Array.isArray(list) || list.length === 0) {
      break;
    }

    let sawOlder = false;
    for (const entry of list) {
      const dateMs = Date.parse(entry?.date);
      if (!Number.isFinite(dateMs) || dateMs < sinceMs) {
        sawOlder = true;
        continue;
      }

      const details = await fetchLimitless(`/tournaments/${entry.id}/details`);
      if (details.decklists === false) {
        continue;
      }
      if (details.isOnline === false) {
        continue;
      }
      const formatId = (details.format || entry.format || '').toUpperCase();
      if (formatId && !SUPPORTED_FORMATS.has(formatId)) {
        continue;
      }

      found.push({
        id: entry.id,
        name: entry.name,
        date: entry.date,
        format: formatId || 'UNKNOWN',
        platform: details.platform || null,
        game: entry.game,
        players: details.players || entry.players || null,
        organizer: details.organizer?.name || null
      });
    }

    if (sawOlder) {
      break;
    }
  }

  return found.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}

function determinePlacementLimit(players) {
  const count = Number(players) || 0;
  if (count > 0 && count <= 4) {
    return 0;
  }
  if (count <= 8) {
    return 4;
  }
  if (count <= 16) {
    return 8;
  }
  if (count <= 32) {
    return 16;
  }
  if (count <= 64) {
    return 24;
  }
  if (count >= 65) {
    return 32;
  }
  return 32;
}

function toCardEntries(decklist) {
  if (!decklist || typeof decklist !== 'object') {
    return [];
  }

  const cards = [];
  for (const [section, entries] of Object.entries(decklist)) {
    if (!Array.isArray(entries)) {
      continue;
    }

    for (const card of entries) {
      const count = Number(card?.count) || 0;
      if (!count) {
        continue;
      }
      const sectionLower = section.toLowerCase();
      let category = 'trainer';
      if (sectionLower === 'pokemon') {
        category = 'pokemon';
      } else if (sectionLower === 'energy') {
        category = 'energy';
      }
      cards.push({
        count,
        name: card?.name || 'Unknown Card',
        set: card?.set || null,
        number: card?.number || null,
        category,
        displayCategory: composeDisplayCategory(category)
      });
    }
  }
  return cards;
}

async function gatherDecks(tournaments) {
  const decks = [];

  for (const tournament of tournaments) {
    const limit = determinePlacementLimit(tournament.players);
    if (!limit) {
      continue;
    }

    let standings;
    try {
      standings = await fetchLimitless(`/tournaments/${tournament.id}/standings`);
    } catch (error) {
      console.warn(`Failed to fetch standings for ${tournament.name}: ${error.message}`);
      continue;
    }

    const sorted = [...standings].sort((a, b) => {
      const placingA = Number.isFinite(a?.placing) ? a.placing : Number.POSITIVE_INFINITY;
      const placingB = Number.isFinite(b?.placing) ? b.placing : Number.POSITIVE_INFINITY;
      return placingA - placingB;
    });

    const topEntries = sorted.slice(0, limit);
    for (const entry of topEntries) {
      const cards = toCardEntries(entry?.decklist);
      if (!cards.length) {
        continue;
      }

      const hash = crypto
        .createHash('sha1')
        .update(
          cards
            .map(card => `${card.count}x${card.name}::${card.set || ''}::${card.number || ''}`)
            .sort()
            .join('|')
        )
        .digest('hex');

      decks.push({
        id: hash.slice(0, 12),
        player: entry?.name || entry?.player || 'Unknown Player',
        playerId: entry?.player || null,
        country: entry?.country || null,
        placement: entry?.placing ?? null,
        archetype: entry?.deck?.name || 'Unknown',
        archetypeId: entry?.deck?.id || null,
        cards,
        tournamentId: tournament.id,
        tournamentName: tournament.name,
        tournamentDate: tournament.date,
        tournamentFormat: tournament.format,
        tournamentPlatform: tournament.platform,
        tournamentOrganizer: tournament.organizer
      });
    }
  }

  return decks;
}

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

function sanitizeForFilename(text) {
  return (text || '').replace(/ /g, '_').replace(/[<>:"/\\|?*]/g, '');
}

function normalizeArchetypeName(name) {
  const cleaned = (name || '').replace(/_/g, ' ').trim();
  if (!cleaned) {
    return 'unknown';
  }
  return cleaned.replace(/\s+/g, ' ');
}

function canonicalizeVariant(setCode, number) {
  const sc = (setCode || '').toUpperCase().trim();
  if (!sc) {
    return [null, null];
  }
  const match = /^(\d+)([A-Za-z]*)$/.exec(String(number || '').trim());
  if (!match) {
    return [sc, String(number || '').trim().toUpperCase()];
  }
  const [, digits, suffix = ''] = match;
  const normalized = digits.padStart(3, '0');
  return [sc, suffix ? `${normalized}${suffix.toUpperCase()}` : normalized];
}

function generateReportFromDecks(deckList, deckTotal) {
  const cardData = new Map();
  const nameCasing = new Map();
  const uidMeta = new Map();
  const uidCategory = new Map();

  for (const deck of deckList) {
    const perDeckCounts = new Map();
    const perDeckMeta = new Map();

    for (const card of deck.cards || []) {
      const count = Number(card?.count) || 0;
      if (!count) {
        continue;
      }
      const [setCode, number] = canonicalizeVariant(card.set, card.number);
      const uid = setCode && number ? `${card.name}::${setCode}::${number}` : card.name;

      perDeckCounts.set(uid, (perDeckCounts.get(uid) || 0) + count);
      perDeckMeta.set(uid, {
        set: setCode || undefined,
        number: number || undefined,
        category: card.category || undefined,
        trainerType: card.trainerType || undefined,
        energyType: card.energyType || undefined,
        displayCategory: card.displayCategory || undefined
      });

      if (!nameCasing.has(uid)) {
        nameCasing.set(uid, card.name);
      }
      if ((card.category || card.trainerType || card.energyType || card.displayCategory) && !uidCategory.has(uid)) {
        uidCategory.set(uid, {
          category: card.category || undefined,
          trainerType: card.trainerType || undefined,
          energyType: card.energyType || undefined,
          displayCategory: card.displayCategory || undefined
        });
      }
    }

    perDeckCounts.forEach((total, uid) => {
      if (!cardData.has(uid)) {
        cardData.set(uid, []);
      }
      cardData.get(uid).push(total);
      if (!uidMeta.has(uid)) {
        uidMeta.set(uid, perDeckMeta.get(uid));
      }
    });
  }

  const sortedKeys = Array.from(cardData.keys()).sort(
    (a, b) => cardData.get(b).length - cardData.get(a).length
  );

  const items = sortedKeys.map((uid, index) => {
    const counts = cardData.get(uid) || [];
    const found = counts.length;
    const distMap = new Map();
    counts.forEach(value => {
      const copies = Number(value) || 0;
      distMap.set(copies, (distMap.get(copies) || 0) + 1);
    });
    const dist = Array.from(distMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([copies, players]) => ({
        copies,
        players,
        percent: found ? Math.round(((players / found) * 100 + Number.EPSILON) * 100) / 100 : 0
      }));

    const entry = {
      rank: index + 1,
      name: nameCasing.get(uid) || uid,
      found,
      total: deckTotal,
      pct: deckTotal ? Math.round(((found / deckTotal) * 100 + Number.EPSILON) * 100) / 100 : 0,
      dist
    };

    if (uid.includes('::')) {
      const meta = uidMeta.get(uid);
      if (meta?.set) {
        entry.set = meta.set;
      }
      if (meta?.number) {
        entry.number = meta.number;
      }
      entry.uid = uid;
    }

    const categoryInfo = uidCategory.get(uid) || uidMeta.get(uid);
    if (categoryInfo) {
      if (categoryInfo.category) {
        entry.category = categoryInfo.category;
      }
      if (categoryInfo.trainerType) {
        entry.trainerType = categoryInfo.trainerType;
      }
      if (categoryInfo.energyType) {
        entry.energyType = categoryInfo.energyType;
      }
      const displayCategory =
        categoryInfo.displayCategory ||
        composeDisplayCategory(categoryInfo.category, categoryInfo.trainerType, categoryInfo.energyType);
      if (displayCategory) {
        entry.displayCategory = displayCategory;
      }
    }

    return entry;
  });

  return {
    deckTotal,
    items
  };
}

function buildArchetypeReports(decks) {
  const groups = new Map();
  const deckTotal = decks.length || 0;
  const minDecks = Math.max(1, Math.ceil(deckTotal * 0.005));

  for (const deck of decks) {
    const displayName = deck.archetype || 'Unknown';
    const normalized = normalizeArchetypeName(displayName);
    const base = sanitizeForFilename(normalized.replace(/ /g, '_')) || 'Unknown';
    if (!groups.has(normalized)) {
      groups.set(normalized, {
        base,
        decks: []
      });
    }
    groups.get(normalized).decks.push(deck);
  }

  const files = [];
  for (const { base, decks: archetypeDecks } of groups.values()) {
    if (archetypeDecks.length < minDecks) {
      continue;
    }
    files.push({
      filename: `${base}.json`,
      base,
      deckCount: archetypeDecks.length,
      data: generateReportFromDecks(archetypeDecks, archetypeDecks.length)
    });
  }

  files.sort((a, b) => b.deckCount - a.deckCount);
  return {
    minDecks,
    files,
    index: files.map(file => file.base)
  };
}

async function putJson(key, data) {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: JSON.stringify(data, null, 2),
      ContentType: 'application/json'
    })
  );
}

async function readJson(key) {
  try {
    const object = await s3Client.send(
      new GetObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key
      })
    );
    const chunks = [];
    for await (const chunk of object.Body) {
      chunks.push(chunk);
    }
    const text = Buffer.concat(chunks).toString('utf-8');
    return JSON.parse(text);
  } catch (error) {
    if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
      return null;
    }
    throw error;
  }
}

// Note: updateTournamentsList() has been removed because online tournaments
// are now treated as a special case and are NOT added to tournaments.json

async function main() {
  const now = new Date();
  const windowStart = daysAgo(WINDOW_DAYS);

  console.log(`[online-meta] Gathering tournaments since ${windowStart.toISOString()}`);
  const tournaments = await fetchRecentOnlineTournaments(windowStart);
  console.log(`[online-meta] Found ${tournaments.length} eligible tournaments`);

  const decks = await gatherDecks(tournaments);
  if (!decks.length) {
    throw new Error('No decklists gathered from online tournaments');
  }

  console.log(`[online-meta] Aggregating ${decks.length} decks`);
  const masterReport = generateReportFromDecks(decks, decks.length);
  const { files: archetypeFiles, index: archetypeIndex, minDecks } = buildArchetypeReports(decks);

  const meta = {
    name: TARGET_FOLDER,
    source: 'limitless-online',
    generatedAt: now.toISOString(),
    windowStart: windowStart.toISOString(),
    windowEnd: now.toISOString(),
    deckTotal: decks.length,
    tournamentCount: tournaments.length,
    archetypeMinPercent: 0.5,
    archetypeMinDecks: minDecks,
    tournaments: tournaments.map(t => ({
      id: t.id,
      name: t.name,
      date: t.date,
      players: t.players,
      format: t.format,
      platform: t.platform,
      organizer: t.organizer
    }))
  };

  const basePath = `${R2_REPORTS_PREFIX}/${TARGET_FOLDER}`;
  await putJson(`${basePath}/master.json`, masterReport);
  await putJson(`${basePath}/meta.json`, meta);
  await putJson(`${basePath}/decks.json`, decks);
  await putJson(`${basePath}/archetypes/index.json`, archetypeIndex);

  for (const file of archetypeFiles) {
    await putJson(`${basePath}/archetypes/${file.filename}`, file.data);
  }

  // Note: Online tournaments are NOT added to tournaments.json
  // They are treated as a special case in the UI

  console.log(
    `[online-meta] Uploaded master + ${archetypeFiles.length} archetypes to ${R2_BUCKET_NAME}/${basePath}`
  );
}

main().catch(error => {
  console.error('[online-meta] Failed:', error);
  process.exit(1);
});
