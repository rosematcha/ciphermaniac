import { loadCardSynonyms } from './lib/cardSynonyms.js';
import { loadCardTypesDatabase } from './lib/cardTypesDatabase.js';

interface Env {
  REPORTS?: { get: (key: string) => Promise<{ text(): Promise<string> } | null> };
  CARD_TYPES_KV?: unknown;
}

interface RequestContext {
  request: Request;
  env: Env;
}

interface ArchetypeIndexEntry {
  name: string;
}

type ChangeFreq = 'daily' | 'weekly' | 'monthly' | 'yearly';

interface UrlEntry {
  loc: string;
  changefreq?: ChangeFreq;
  priority?: number;
}

const ONLINE_META_TOURNAMENT = 'Online - Last 14 Days';
const ARCHETYPE_INDEX_KEY = `reports/${ONLINE_META_TOURNAMENT}/archetypes/index.json`;

const STATIC_ROUTES: Array<{ path: string; changefreq: ChangeFreq; priority: number }> = [
  { path: '/', changefreq: 'daily', priority: 1.0 },
  { path: '/cards', changefreq: 'daily', priority: 0.9 },
  { path: '/archetypes', changefreq: 'daily', priority: 0.9 },
  { path: '/trends', changefreq: 'daily', priority: 0.9 },
  { path: '/suggested', changefreq: 'weekly', priority: 0.5 },
  { path: '/tools/meta-binder', changefreq: 'weekly', priority: 0.6 },
  { path: '/tools/social-graphics', changefreq: 'monthly', priority: 0.4 },
  { path: '/about', changefreq: 'monthly', priority: 0.5 },
  { path: '/feedback', changefreq: 'monthly', priority: 0.4 }
];

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildUrl(origin: string, path: string): string {
  return new URL(path, origin).toString();
}

function renderUrl({ loc, changefreq, priority }: UrlEntry): string {
  const lines = ['  <url>', `    <loc>${escapeXml(loc)}</loc>`];
  if (changefreq) {
    lines.push(`    <changefreq>${changefreq}</changefreq>`);
  }
  if (typeof priority === 'number') {
    lines.push(`    <priority>${priority.toFixed(1)}</priority>`);
  }
  lines.push('  </url>');
  return lines.join('\n');
}

async function loadArchetypeIndex(env: Env): Promise<ArchetypeIndexEntry[]> {
  if (!env.REPORTS) {
    return [];
  }

  try {
    const object = await env.REPORTS.get(ARCHETYPE_INDEX_KEY);
    if (!object) {
      return [];
    }
    const text = await object.text();
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Failed to load archetype index for sitemap:', error);
    return [];
  }
}

function parseUidToKey(uid: string): string | null {
  if (!uid || !uid.includes('::')) {
    return null;
  }
  const parts = uid.split('::');
  if (parts.length < 3) {
    return null;
  }
  const set = String(parts[1]).toUpperCase();
  const number = String(parts[2]).toUpperCase();
  if (!set || !number) {
    return null;
  }
  return `${set}::${number}`;
}

function buildSynonymExclusions(synonyms: Record<string, string> | undefined): Set<string> {
  const exclusions = new Set<string>();
  if (!synonyms) {
    return exclusions;
  }

  for (const [uid, canonicalUid] of Object.entries(synonyms)) {
    const synonymKey = parseUidToKey(uid);
    const canonicalKey = parseUidToKey(canonicalUid);
    if (!synonymKey || !canonicalKey) {
      continue;
    }
    if (synonymKey !== canonicalKey) {
      exclusions.add(synonymKey);
    }
  }

  return exclusions;
}

export async function onRequest({ request, env }: RequestContext): Promise<Response> {
  const { origin } = new URL(request.url);
  const urls: UrlEntry[] = [];
  const seen = new Set<string>();

  for (const route of STATIC_ROUTES) {
    const loc = buildUrl(origin, route.path);
    urls.push({ loc, changefreq: route.changefreq, priority: route.priority });
    seen.add(loc);
  }

  const [archetypeIndex, cardTypesDb, synonymDb] = await Promise.all([
    loadArchetypeIndex(env),
    loadCardTypesDatabase(env as any),
    loadCardSynonyms(env as any)
  ]);

  const synonymExclusions = buildSynonymExclusions((synonymDb as any)?.synonyms);

  archetypeIndex
    .filter(entry => entry && typeof entry.name === 'string' && entry.name.trim())
    .forEach(entry => {
      const slug = encodeURIComponent(entry.name);
      const base = buildUrl(origin, `/${slug}`);
      const analysis = buildUrl(origin, `/${slug}/analysis`);
      const trends = buildUrl(origin, `/${slug}/trends`);

      [base, analysis, trends].forEach((loc, index) => {
        if (seen.has(loc)) {
          return;
        }
        const priority = index === 0 ? 0.7 : 0.6;
        urls.push({ loc, changefreq: 'weekly', priority });
        seen.add(loc);
      });
    });

  if (cardTypesDb && typeof cardTypesDb === 'object') {
    const cardKeys = Object.keys(cardTypesDb as Record<string, unknown>).sort();
    for (const key of cardKeys) {
      const parts = key.split('::');
      if (parts.length < 2) {
        continue;
      }
      const set = String(parts[0]).toUpperCase();
      const number = String(parts[1]).toUpperCase();
      const normalizedKey = `${set}::${number}`;
      if (!set || !number || synonymExclusions.has(normalizedKey)) {
        continue;
      }

      const slug = `${encodeURIComponent(set)}~${encodeURIComponent(number)}`;
      const loc = buildUrl(origin, `/card/${slug}`);
      if (seen.has(loc)) {
        continue;
      }
      urls.push({ loc, changefreq: 'weekly', priority: 0.4 });
      seen.add(loc);
    }
  }

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map(renderUrl),
    '</urlset>'
  ].join('\n');

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=UTF-8',
      'Cache-Control': 'public, max-age=3600'
    }
  });
}
