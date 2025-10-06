// Cloudflare Pages Function to serve card.html for all /card/* routes
export async function onRequest(context) {
  // Serve card.html for any /card/* path
  return context.env.ASSETS.fetch(new URL('/card.html', context.request.url));
}
