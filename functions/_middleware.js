// Cloudflare Pages middleware for URL rewrites
export async function onRequest(context) {
  const url = new URL(context.request.url);
  const pathname = url.pathname;

  // Rewrite /card and /card/* to /card.html
  if (pathname === '/card' || pathname.startsWith('/card/')) {
    // Don't rewrite if it's already card.html
    if (pathname === '/card.html') {
      return context.next();
    }

    // Rewrite to /card.html while preserving query params
    url.pathname = '/card.html';
    const newRequest = new Request(url.toString(), context.request);
    return context.env.ASSETS.fetch(newRequest);
  }

  // Let other requests pass through
  return context.next();
}
