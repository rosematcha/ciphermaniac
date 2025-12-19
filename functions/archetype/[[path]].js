/**
 * Redirects /archetype/* to root /*
 */
export async function onRequest(context) {
  const url = new URL(context.request.url);
  // Replace /archetype/Foo with /Foo, /archetype/Foo/trends with /Foo/trends
  const newPath = url.pathname.replace(/^\/archetype/, '');
  // Ensure we don't end up with empty path if it was just /archetype
  const finalPath = newPath || '/archetypes';

  // If it was just /archetype or /archetype/, redirect to /archetypes listing
  if (finalPath === '/' || finalPath === '') {
    return Response.redirect(new URL('/archetypes', url), 301);
  }

  return Response.redirect(new URL(finalPath, url), 301);
}
