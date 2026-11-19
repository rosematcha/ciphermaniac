import { defineConfig, type Plugin, type UserConfig } from 'vite';
import solid from 'vite-plugin-solid';
import { resolve } from 'node:path';
import { EMBEDDED_RELEASE } from './shared/generated/release.js';

/**
 * Inline the release manifest into index.html as JSON, read by src/lib/releaseClient.ts.
 * Kept out of the module graph so a data-only release renames no JS chunk.
 * `<` is escaped so manifest strings can't close the script element. It goes at
 * the end of the head, so `<meta charset>` stays within the first 1024 bytes.
 */
function embedRelease(manifest: unknown): Plugin {
  const children = JSON.stringify(manifest).replaceAll('<', '\\u003c');
  return {
    name: 'embedded-release',
    transformIndexHtml: () =>
      manifest === null
        ? []
        : [{ tag: 'script', attrs: { type: 'application/json', id: 'release' }, children, injectTo: 'head' }]
  };
}

/**
 * Ciphermaniac frontend — Vite + Solid.
 *
 * Output goes to `dist/` so Cloudflare Pages can serve it (see wrangler.toml).
 * Static assets that should be served verbatim live in `static/` (Vite's publicDir).
 * The `functions/` directory is untouched — Pages picks it up alongside the static build.
 * Tests and benchmarks build it with their own `release`.
 */
export function appConfig(release: unknown): UserConfig {
  return {
    plugins: [solid(), embedRelease(release)],
    publicDir: 'static',
    build: {
      outDir: 'dist',
      manifest: true,
      emptyOutDir: true,
      target: 'es2022',
      minify: 'terser',
      sourcemap: false,
      rollupOptions: {
        output: {
          // Keep entry + chunk filenames predictable so cache busting is by hash only.
          entryFileNames: 'assets/[name]-[hash].js',
          chunkFileNames: 'assets/[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
          codeSplitting: {
            groups: [
              {
                name: 'core',
                priority: 2,
                test: /src[\\/]lib[\\/](format|concurrency)\.ts$/,
                includeDependenciesRecursively: false
              }
            ]
          }
        }
      }
    },
    resolve: {
      alias: {
        '~': resolve(import.meta.dirname, 'src')
      }
    },
    server: {
      port: 5173,
      strictPort: false,
      proxy: {
        // Cloudflare Functions (upcoming-tournaments scraper, feedback, and the
        // Limitless proxies) live at /api/*. Vite does not run them, so this
        // proxies to a LOCAL Wrangler — run `npm run dev:functions` in a second
        // terminal. Without it the proxy fails and the affected panels show their
        // "couldn't load" empty state; every other route works, since page data
        // comes straight from r2.ciphermaniac.com.
        //
        // Deliberately local rather than production: /api includes an endpoint
        // that sends mail, and a dev session must not reach it.
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
  };
}

export default defineConfig(appConfig(EMBEDDED_RELEASE));
