// Cloudflare Pages Function to serve card.html for /card route
export async function onRequest(context) {
  // Serve card.html for /card path
  return context.env.ASSETS.fetch(new URL('/card.html', context.request.url));
}
