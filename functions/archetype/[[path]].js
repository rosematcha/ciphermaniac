/* global URL, Response */

export async function onRequest(context) {
  const requestUrl = new URL(context.request.url);

  if (requestUrl.pathname === '/archetype' || requestUrl.pathname === '/archetype/') {
    return Response.redirect(new URL('/archetypes', requestUrl), 301);
  }

  // Serve the static archetype template for any nested path like /archetype/<name>
  return context.env.ASSETS.fetch(new URL('/archetype.html', requestUrl));
}
