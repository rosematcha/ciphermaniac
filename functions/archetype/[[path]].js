/* global URL, Response */

export async function onRequest(context) {
  const requestUrl = new URL(context.request.url);

  if (requestUrl.pathname === '/archetype' || requestUrl.pathname === '/archetype/') {
    return Response.redirect(new URL('/archetypes', requestUrl), 301);
  }

  // Serve the static archetype template for any nested path like /archetype/<name>
  const candidates = ['/archetype.html', '/archetype', '/archetype/index.html'];

  for (const relativePath of candidates) {
    const assetUrl = new URL(relativePath, requestUrl);
    const assetResponse = await context.env.ASSETS.fetch(assetUrl);

    if (assetResponse.status >= 300 && assetResponse.status < 400) {
      const redirectLocation = assetResponse.headers.get('location');
      if (!redirectLocation) {
        continue;
      }

      const followResponse = await context.env.ASSETS.fetch(new URL(redirectLocation, requestUrl));
      if (followResponse.ok) {
        return followResponse;
      }
      continue;
    }

    if (assetResponse.ok) {
      return assetResponse;
    }
  }

  return new Response('Not found', { status: 404 });
}
