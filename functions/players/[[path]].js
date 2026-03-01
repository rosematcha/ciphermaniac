/**
 * Router for /players routes
 * - /players -> players.html
 * - /players/:slug -> player.html
 */
export async function onRequest(context) {
  const url = new URL(context.request.url);
  const pathParts = url.pathname.split('/').filter(Boolean);

  if (!pathParts.length || pathParts[0].toLowerCase() !== 'players') {
    return context.env.ASSETS.fetch(url);
  }

  if (pathParts.length === 1) {
    return context.env.ASSETS.fetch(new URL('/players.html', url));
  }

  if (pathParts.length === 2) {
    return context.env.ASSETS.fetch(new URL('/player.html', url));
  }

  const assetResponse = await context.env.ASSETS.fetch(url);
  if (assetResponse.ok) {
    return assetResponse;
  }

  return new Response('Not found', { status: 404 });
}
