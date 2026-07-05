import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import { resolve } from 'node:path';

/**
 * Ciphermaniac frontend — Vite + Solid.
 *
 * Output goes to `dist/` so Cloudflare Pages can serve it (see wrangler.toml).
 * Static assets that should be served verbatim live in `static/` (Vite's publicDir).
 * The `functions/` directory is untouched — Pages picks it up alongside the static build.
 */
export default defineConfig({
  plugins: [solid()],
  publicDir: 'static',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Keep entry + chunk filenames predictable so cache busting is by hash only.
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]'
      }
    }
  },
  resolve: {
    alias: {
      '~': resolve(__dirname, 'src')
    }
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      // Cloudflare Functions (upcoming-tournaments scraper, etc.) live at /api/*.
      // In dev we don't run Wrangler; proxy through to production so the calls just work.
      // In dev, run `npx wrangler pages dev dist --port 8788` alongside `npm run dev`
      // to serve Cloudflare Functions (the upcoming-tournaments scraper, etc.) locally.
      // If wrangler isn't running, this proxy will fail and the UI will show its
      // "couldn't load" empty state — that's fine, prod still works.
      '/api': {
        target: 'http://localhost:8788',
        changeOrigin: true,
        secure: false
      },
      // SocialGraphicsPage loads thumbnails through the /thumbnails Pages Function
      // (same-origin so the canvas export isn't CORS-tainted). Vite doesn't run
      // Functions, so proxy to production to avoid a local wrangler dependency.
      '/thumbnails': {
        target: 'https://ciphermaniac.com',
        changeOrigin: true,
        secure: true
      }
    }
    // Card art must also load same-origin via the /thumbnails proxy (or R2) —
    // hotlinking the LimitlessTCG CDN directly breaks in browsers (its __cf_bm
    // cookie is rejected as a public-suffix cookie). See src/components/CardImage.tsx.
  }
});
