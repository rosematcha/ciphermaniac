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
      // Cloudflare Functions (upcoming-tournaments scraper, feedback, survey,
      // the Limitless proxies) live at /api/*. Vite does not run them, so this
      // proxies to a LOCAL Wrangler — run `npm run dev:functions` in a second
      // terminal. Without it the proxy fails and the affected panels show their
      // "couldn't load" empty state; every other route works, since page data
      // comes straight from r2.ciphermaniac.com.
      //
      // Deliberately local rather than production: /api includes endpoints that
      // send mail and write to D1, and a dev session must not reach them.
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
      },
      // Same deal for the label maker's Pokémon sprites (/sprites Pages
      // Function) — same-origin keeps its canvas exportable.
      '/sprites': {
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
