/**
 * Root-level router for Ciphermaniac
 * Handles:
 * - /:archetype -> archetype-home.html
 * - /:archetype/analysis -> archetype.html
 * - /:archetype/trends -> archetype-trends.html
 * - Fallback to static assets for everything else
 */

// Paths that should NOT be treated as archetypes
const RESERVED_PATHS = new Set([
  'api',
  'assets',
  'tools',
  'archetypes',
  'cards',
  'card', // handled by functions/card/[[path]].js
  'feedback',
  'trends', // global trends page
  'suggested',
  'about',
  'index.html',
  'favicon.ico',
  'robots.txt',
  'sitemap.xml'
]);

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const { pathname } = url;

  // Clean up path
  const pathParts = pathname.split('/').filter(Boolean);

  // Handle root
  if (pathParts.length === 0) {
    return context.env.ASSETS.fetch(url);
  }

  const firstSegment = pathParts[0].toLowerCase();

  // If reserved, let ASSETS handle it (or other Functions)
  if (RESERVED_PATHS.has(firstSegment)) {
    return context.env.ASSETS.fetch(url);
  }

  // If it's the old /archetype/ route, redirect to new location
  if (firstSegment === 'archetype') {
    // Logic handled in functions/archetype/[[path]].js, but if this catches it first:
    // It shouldn't, specific routes usually win.
    // But if it does, we can pass it through.
    return context.env.ASSETS.fetch(url);
  }

  // Assume it's an archetype slug
  // Route: /:slug or /:slug/subpage
  const _archetypeSlug = pathParts[0]; // Keep original case for slug? Usually we normalize or decode later.
  const subpage = pathParts[1] ? pathParts[1].toLowerCase() : null;

  // Validate subpage if present
  if (subpage && !['analysis', 'trends'].includes(subpage)) {
    // Unknown subpage, might be a 404 or a static asset that looks like an archetype?
    // Let's try to fetch it as an asset first.
    const assetResponse = await context.env.ASSETS.fetch(url);
    if (assetResponse.ok) {
      return assetResponse;
    }

    // If not found, maybe 404?
    // Or maybe we treat it as Home?
    return new Response('Not found', { status: 404 });
  }

  // Determine template
  let templatePath = '/archetype-home.html';
  if (subpage === 'analysis') {
    templatePath = '/archetype.html';
  } else if (subpage === 'trends') {
    templatePath = '/archetype-trends.html';
  }

  // Serve the template
  const newUrl = new URL(templatePath, url);
  return context.env.ASSETS.fetch(newUrl);
}
