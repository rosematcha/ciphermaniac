/**
 * Redirects /archetype/* to root /*
 * @param {{ request: Request }} context
 */
export async function onRequest(context) {
  const url = new URL(context.request.url);
  // Replace /archetype/Foo with /Foo, /archetype/Foo/trends with /Foo/trends
  const newPath = url.pathname.replace(/^\/archetype/, '');

  // If it was just /archetype or /archetype/, redirect to /archetypes listing.
  // Otherwise strip the /archetype prefix.
  //
  // Mutate url.pathname in place (rather than `new URL(finalPath, url)`): an
  // absolute-path first argument to the URL constructor discards the base URL's
  // search and hash, silently dropping query params like ?tour=X&tab=analysis
  // and fragments like #cards.
  const finalPath = newPath || '/';
  url.pathname = finalPath === '/' ? '/archetypes' : finalPath;

  return Response.redirect(url.toString(), 301);
}
