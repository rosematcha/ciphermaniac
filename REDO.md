# REDO — Frontend Rebuild Brief

This repo just had its entire UI layer scrapped on purpose. The Cloudflare Pages backend (`functions/`), build scripts (`scripts/`), isomorphic shared code (`shared/`), and the data-layer pieces of `src/` are intact. A new agent is expected to design and implement a new frontend on top of what remains — **with no obligation to honor any previous design decision.**

---

## 1. Project Snapshot

- **What it is:** Ciphermaniac — a free Pokémon TCG meta-analysis tool. Ingests competitive tournament results (Limitless TCG), surfaces per-card usage rates, deck archetype breakdowns, meta-trend shifts over time, and recurring-player statistics.
- **Hosting:** Cloudflare Pages. Static assets in `public/`, dynamic routes in `functions/` (Pages Functions, runs on Cloudflare Workers).
- **Data sources:**
  - Pre-built tournament reports stored in R2 (fetched via `src/api.ts`).
  - Limitless TCG API (proxied by `functions/api/limitless/tournaments.ts`).
  - A rolling "Online - Last 14 Days" report generated on a cron by `functions/_cron/online-meta.ts`.
  - Card synonyms and card-type databases under `functions/lib/data/`.
- **Client storage:** A SQLite database (one per tournament) loaded in-browser via `sql.js` (WASM). Wrapper lives at `src/lib/database.ts`.
- **Domain:** ciphermaniac.com.

---

## 2. What Was Scrapped vs. Preserved

### Scrapped (deleted in this commit, before rebuild)
- All `public/*.html` pages, `public/toys/`, `public/assets/` (CSS/JS bundles, fonts, images, OG image, sql.js wasm, JSON data files), `public/sw.js`, `public/_headers`, `public/_redirects`, `public/_routes.json`, `public/site.webmanifest`, `public/sitemap.xml`, `public/llms.txt`, `public/favicon.*`, `public/robots.txt`.
- All UI-coupled `src/` code: page entrypoints, `src/components/`, `src/render/`, `src/loaders/`, `src/card/`, `src/archetype/`, `src/archetype-trends/`, `src/players/`, `src/trends/`, `src/main/`, `src/react-app/`, `src/social-graphics/`, `src/tools/`, `src/dev/`, `src/router.ts`, `src/main.ts`, `src/ui.ts`, `src/render.ts`, `src/controls.ts`, `src/thumbs.ts`, `src/layoutHelper.ts`.
- DOM-coupled utilities: `src/utils/dom.ts`, `html.ts`, `tooltip.ts`, `filtersPanel.ts`, `filterState.ts`, `scrollRestore.ts`, `parallelImageLoader.ts`, `parallelLoader.ts`, `performance.ts`, `seo.ts`.
- UI router: `src/lib/routing.ts`.
- UI tests: `tests/client/`, `tests/archetype/`, `tests/e2e/`, `playwright-report/`, `test-results/`, `playwright.config.ts`.
- Stale planning/style docs: `RESTRUCTURING_PLAN.md`, `STYLE.md`, `.bundlesize-history.json`.

### Preserved
- `functions/` — Cloudflare Pages backend (untouched).
- `scripts/` — build/dev/test scripts (some reference removed paths; see §7).
- `shared/` — isomorphic `cardUtils.ts`, `reportUtils.ts`, `synonyms.ts`.
- `config/` — wrangler subset, JSDoc config, R2 CORS rules, `.htaccess`.
- Data-layer `src/`: `api.ts`, `parse.ts`, `config.ts`, `types/`, `data/`, `lib/database.ts`, and a trimmed `src/utils/` subset (see §6).
- Tests: `tests/api/`, `tests/data/`, `tests/shared/`, `tests/utils/`, `tests/security/`, `tests/edge-cases/`, `tests/performance/`, `tests/reliability/`, `tests/integration/`, plus `tests/__fixtures__/`, `tests/__mocks__/`, `tests/__utils__/`.
- Tooling: `package.json`, `tsconfig*.json`, `wrangler.toml`, `.eslintrc.json`, `.prettierrc.json`, `.editorconfig`, `.husky/`, `knip.config.ts`, `global.d.ts`, `types/`, `README.md`.

---

## 3. Pages That Existed

Each entry: route, purpose, key features, primary data source. Use this as a feature inventory — the new frontend does **not** have to mirror this structure.

### Main pages

#### `/` — Home
- **Purpose:** Landing page; orient the visitor to the meta and route them to the depth they want.
- **Features:** Featured archetype gallery cards, summary stats for the current/online meta, top-level navigation to cards/archetypes/trends/players, link to toys.
- **Data:** Current online-meta report (R2), archetype index (R2).

#### `/archetypes` — Archetype gallery
- **Purpose:** Browse all meta-relevant deck archetypes for a given tournament/segment.
- **Features:** Tournament selector, sort by meta share / win rate, archetype thumbnails, click-through to detail.
- **Data:** Archetype index for the selected tournament.

#### `/archetype/{id}` — Archetype detail
- **Purpose:** Deep dive into one archetype's composition and performance.
- **Features:** Core/flex card lists, deck skeleton, included/excluded card filters, performance tier breakdown, trends tab link, export.
- **Data:** Archetype-filtered report (via `functions/api/archetype/filter-report.ts`).

#### `/archetype/{id}/home` — Archetype overview variant
- **Purpose:** Higher-level summary of an archetype (an alternative landing view to the detail page).
- **Features:** Hero card image, key stats, signature cards.
- **Data:** Same as detail; lighter rendering.

#### `/archetype/{id}/trends` — Per-archetype card-usage trends
- **Purpose:** Track how a single archetype's card usage shifted across tournaments.
- **Features:** Time-series chart per card slot, set/regulation filters, time-window selector.
- **Data:** Card trends report aggregated across the historical tournament set.

#### `/cards` — Card database
- **Purpose:** Searchable database of every card seen in competitive play.
- **Features:** Search + filters (set, archetype, card type, regulation mark, placement tier, tournament), usage percentage display, copy-count distribution, pagination/virtualized grid.
- **Data:** Card distributions from the per-tournament SQLite DB (sql.js).

#### `/card/{id}` — Card detail
- **Purpose:** Everything about one card: how it's played, where it places, what it costs.
- **Features:** Inclusion rate over time, copy-count breakdown, which archetypes use it, market price (`PricingData`), missing-card variant resolution, modal navigation.
- **Data:** Per-card report slice + pricing + synonyms.

#### `/trends` — Meta-wide deck-popularity trends
- **Purpose:** See which decks are rising/falling.
- **Features:** Multi-line stacked chart by archetype, time-window selector, performance-tier filter (e.g. all vs phase2 vs topcut).
- **Data:** `TrendReportPayload` from preaggregated reports.

#### `/players` — Regional player index
- **Purpose:** Surface recurring Regional/IC players and their performance.
- **Features:** Filter by region, sort by consistency score / top finishes, search by name.
- **Data:** Player aggregation from tournament reports.

#### `/player/{id}` — Player profile
- **Purpose:** One player's competitive history.
- **Features:** Tournament history, archetype specialization, match record summary, top-finish rate.
- **Data:** `PlayerMatchRecord[]` + `CanonicalMatchRecord` rollups across tournaments.

#### `/feedback` — Feedback form
- **Purpose:** Collect bug reports / feature requests.
- **Features:** Form posts to `functions/api/feedback.ts`.
- **Data:** Write-only; feedback API persists submissions.

#### `/about` — About page
- **Purpose:** Project background, credits, data-source attribution, contact.
- **Features:** Static content.

#### `/suggested` — Redirect
- **Purpose:** Legacy/external redirect target. Reproduce only if old inbound links matter.

### Toys (experimental / secondary)

#### `/toys` — Toys hub
Index of the experimental tools below.

#### `/toys/meta-binder` — Meta Binder
- **Purpose:** Help collectors build a single binder/playset that covers the current meta.
- **Features:** Pulls the union of top-N archetypes' core cards, deduplicates, surfaces a printable shopping list with copy counts.
- **Data:** Online-meta archetype reports.

#### `/toys/in-loving-memory` — Rotated archetypes archive
- **Purpose:** Memorialize archetypes no longer legal under current regulation marks.
- **Features:** Historical archetype thumbnails with last-seen tournament and reason for rotation.
- **Data:** Older tournament reports.

#### `/toys/player-connections` — Player connection graph
- **Purpose:** Kevin-Bacon-style network: how are any two players linked by shared tournaments?
- **Features:** Interactive graph (clickable nodes), pathfinding between two selected players, list of tournaments connecting them.
- **Data:** All historical `TournamentParticipant` records.

#### `/toys/social-graphics` — Tournament social graphics generator
- **Purpose:** Generate shareable PNG/JPEG graphics summarizing a tournament's top 8 / meta share.
- **Features:** Tournament picker, layout variants, downloadable rendered image. Multiple prototype variants existed under `public/toys/social-graphics-prototypes/`.
- **Data:** Tournament report + archetype thumbnails. Note: thumbnails endpoint at `functions/thumbnails/[[path]].ts` is still wired up.

#### `/toys/incidents` — Tournament incidents
- **Purpose:** Database of recorded notable tournament incidents (DQs, rulings).
- **Features:** Sortable/filterable table.
- **Data:** Static or KV-backed list.

---

## 4. Backend API Surface (preserved)

These routes are live in `functions/` and ready for the new frontend to call.

| Path | Source | What it returns |
|---|---|---|
| `/api/archetype/filter-report` | `functions/api/archetype/filter-report.ts` | Archetype-filtered tournament report. Accepts include/exclude card filters. |
| `/api/feedback` | `functions/api/feedback.ts` | POST-only; persists feedback submissions. |
| `/api/limitless/tournaments` | `functions/api/limitless/tournaments.ts` | Proxied Limitless TCG tournaments list. |
| `/archetype/*` | `functions/archetype/[[path]].js` | Archetype data routes (catch-all). |
| `/card/*` | `functions/card/[[path]].js` | Card data routes (catch-all). |
| `/players/*` | `functions/players/[[path]].js` | Player data routes (catch-all). |
| `/reports/:tournament/manifest.json` | `functions/reports/[tournament]/manifest.json.ts` | Tournament report manifest. |
| `/thumbnails/*` | `functions/thumbnails/[[path]].ts` | Dynamic archetype/card thumbnail generation. |
| `/sitemap.xml` | `functions/sitemap.xml.ts` | Dynamic sitemap. Will need updating to reflect the new route set. |
| `/*` (fallback) | `functions/[[path]].js` | Catch-all router/redirect logic. May contain legacy URL rewrites — review before relying on. |

Cron:
- `functions/_cron/online-meta.ts` — rebuilds the rolling "Online - Last 14 Days" report. Triggered by a Cloudflare schedule; see `wrangler.toml`.

Backend internal libs (don't call directly from frontend, but documenting since they shape the API output):
- `functions/lib/analysis/` — archetype classifier, card-trend builder, card-type inference.
- `functions/lib/api/` — Limitless wrapper, response helpers.
- `functions/lib/data/` — card-synonyms, card-types DB, report builder, SQLite builder.
- `functions/lib/onlineMeta/` — online-meta report generation pipeline.
- `functions/lib/util/cardUtils.ts` — id/path/normalization helpers.

---

## 5. Data Shapes

All canonical types live in `src/types/index.ts`. **Treat that file as the source of truth — do not duplicate definitions here.** The most load-bearing types:

- `CardItem`, `CardDistributionEntry` — a single card and its copy-count distribution within a report.
- `DeckCard`, `Deck` — a decklist.
- `TournamentParticipant`, `PlayerMatchRecord`, `CanonicalMatchRecord` — match-result granularity.
- `TournamentReport`, `ArchetypeReport extends TournamentReport`, `TournamentManifest` — top-level report payloads.
- `ParsedReport` — output of `parseReport()` in `src/parse.ts`.
- `ArchetypeIndexEntry`, `ArchetypeSuccessSummaryByTag`, `SignatureCardEntry` — archetype directory shapes.
- `MetaReport`, `MetaTournamentEntry` — meta-wide rollups.
- `TrendDataPoint`, `TrendSeries`, `CardTrendEntry`, `CardTrendsReport`, `TrendReport`, `TrendReportPayload` — time-series shapes for the trends page.
- `Filter`, `Operator`, `ArchetypeFilterRequest`, `ArchetypeFilterResponse`, `PlacementRule`, `PercentRule` — filter DSL used by `/api/archetype/filter-report`.
- `PricingData` — TCGPlayer-style pricing payload used by `/card/:id`.
- `CacheEntry<T>` — generic cache entry.

`ReportSlice` (`'all' | 'phase2' | 'topcut'`) is exported from `src/api.ts` and is how reports are sliced by performance tier.

---

## 6. Reusable Data-Layer Modules (preserved in `src/`)

| File | Purpose |
|---|---|
| `src/api.ts` | Main API client. Loads tournament manifests, archetype reports, meta reports, card trends, pricing. Handles caching, retry, telemetry. Exports `ONLINE_META_NAME` constant. |
| `src/parse.ts` | `parseReport(data)` + item validation. Pure, no DOM. |
| `src/config.ts` | Centralized constants. `LAYOUT.*` is UI-flavored and can be ignored/removed; `API`, `CACHE`, `UI` (timings/limits), `DEV` are still useful. |
| `src/types/index.ts` | Canonical type definitions (see §5). |
| `src/data/performanceTiers.ts` | Constants describing `phase2` / `topcut` slice rules. |
| `src/data/setCatalog.ts` | Pokémon set metadata / lookup. |
| `src/lib/database.ts` | sql.js client. Loads per-tournament SQLite DBs from R2 and runs queries. |
| `src/utils/DataCache.ts`, `cache.ts` | In-memory TTL caches (`TtlCache`). |
| `src/utils/cardSynonyms.ts`, `cardTypeHierarchy.ts` | Card-name normalization, type lookups. |
| `src/utils/clientSideFiltering.ts` | Pure filter-evaluation logic (no DOM). |
| `src/utils/errorHandler.ts` | `AppError`, `ErrorTypes`, `safeFetch`, `withRetry`, `validateType`, `assert`. |
| `src/utils/featureFlags.ts`, `releaseChannel.ts` | Build-time / release-channel feature flags. Used by `scripts/apply-release-flags.mjs`. |
| `src/utils/format.ts` | Number/percent/card formatting helpers (no DOM). |
| `src/utils/logger.ts` | Structured logger. |
| `src/utils/reportAggregator.ts`, `trendAggregator.ts` | Pure-logic aggregation over reports / trend payloads. |
| `src/utils/storage.ts` | localStorage wrapper. Browser-only but framework-agnostic. |
| `src/utils/tournamentRecency.ts` | `sortTournamentNamesByRecency()`. |
| `src/utils/buildVersion.ts` | Build version constant (rewritten at build time by `apply-release-flags.mjs`). |
| `shared/cardUtils.ts` | Isomorphic card-id/slug helpers — works in browser, Node, and Workers. |
| `shared/reportUtils.ts` | Isomorphic report helpers. |
| `shared/synonyms.ts` | Card-synonym map. |

---

## 7. Known Broken After the Scrap

The build pipeline assumed the old UI. Expect these to fail until the new frontend is laid out:

- **`package.json`:**
  - `lint` / `lint:fix` enumerate deleted files (`src/feedback.ts`, `src/incidents.ts`, `src/dev/layoutTests.ts`, `src/tools/metaBinderData.ts`). Update the `--ext .ts tests` line to whatever entrypoints the new UI introduces.
  - `clean` removes specific CSS file names that no longer exist.
  - `postinstall` runs `npm run build`; build will fail until the frontend is rebuilt — consider removing this line during the rebuild.
  - `c8.include` lists many deleted source paths; trim it to reflect the new layout.
  - `main` field still points at `public/assets/js/main.js`.
- **`tsconfig.frontend.json`:** Its `include` list may reference deleted subdirectories. Re-scope to whatever the new frontend uses.
- **`scripts/build-css-simple.mjs`:** Bundles per-page CSS files that no longer exist. Either rewrite or replace with the new build's bundler.
- **`scripts/build-production.mjs`:** Likely references frontend entrypoints — review.
- **`scripts/apply-release-flags.mjs`:** Injects flags into HTML files that no longer exist. Adapt to the new build's HTML output (or template) format.
- **`scripts/check-bundle-size.mjs`:** Has hardcoded budgets for old bundles. Reset or rescope.
- **`scripts/dev-server.mjs`:** Was the local dev server for the old setup. Decide whether to keep or replace with the new framework's dev server.
- **`wrangler.toml`:** Points at `public/` as the static asset dir. Still valid — but make sure the new build outputs there (or update the config).
- **`global.d.ts`, `types/`:** Quick scan — may contain UI-specific globals that can be pruned.
- **`functions/sitemap.xml.ts`:** Generates sitemap entries based on the old route set. Rewrite to match new routes once finalized.
- **`functions/[[path]].js`:** Catch-all that may contain legacy redirects for retired URLs. Review.

The Cloudflare backend itself will keep working when deployed (the API routes are independent of the static site), but `public/` is currently empty, so visiting the site will 404 everywhere except `/api/*` and other `functions/` routes.

---

## 8. Constraints / Conventions to Carry Forward

These are platform/data realities, not design opinions — honor them:

- **Cloudflare Pages.** Anything dynamic goes in `functions/`. Static output goes in `public/` (configurable via `wrangler.toml`). No Node-only APIs in `functions/`; they run on Workers.
- **Bundle size matters.** The old site shipped a per-page CSS/JS split and policed total bundle size with `scripts/check-bundle-size.mjs`. Whatever framework you pick, keep an eye on first-load weight.
- **`sql.js` is heavy (~1 MB WASM).** It was loaded lazily by `/cards` and `/card/:id`. Either keep that lazy pattern or move heavy queries server-side via a new function.
- **`llms.txt` existed at `/llms.txt`.** Rebuild it — it's the AI-readable site summary used by LLM crawlers. Old content described the site's features and listed major pages with URLs.
- **`robots.txt`, `sitemap.xml`, `site.webmanifest`, favicons** all existed at the obvious paths and need to come back (sitemap is dynamic — see §7).
- **R2 bucket layout.** The API client in `src/api.ts` knows where to fetch tournament JSON, manifests, pricing, synonyms. Don't rename R2 paths without updating that client.
- **Online-meta cadence.** `functions/_cron/online-meta.ts` rebuilds the rolling 14-day report. Don't break it.
- **Feature flags / release channels.** `src/utils/featureFlags.ts` + `apply-release-flags.mjs` provide a build-time flag mechanism. Use it or replace it intentionally — don't leave dead references.

---

## 9. Out of Scope (for the rebuild brief)

This document does **not** prescribe:

- A framework. Pick what fits (vanilla TS, React, SolidJS, Astro, SvelteKit, etc.). The old site was vanilla TS with per-page entrypoints; you are free to do something completely different.
- A design system, color palette, typography, or layout language. The old site used Fraunces (and recently switched the wordmark to Big Shoulders Display with an amber underbar — see recent commits). Treat all prior design choices as discarded.
- A file structure under `src/`. The preserved data-layer files happen to live where they do today; the new frontend may reorganize them freely (just update imports).
- Routing strategy. Old routes are documented in §3 for feature parity *if you want it* — but URLs are not load-bearing except for `/api/*` and other `functions/`-served paths (which must stay).
- Build tooling. Vite, esbuild, Astro, plain `tsc` — your call. Just keep `wrangler.toml`'s static-asset directory in sync with whatever the build outputs.
