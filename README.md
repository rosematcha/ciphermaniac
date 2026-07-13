<a href="https://ciphermaniac.com">
  <p align="center">
    <img src="public/assets/images/logo.svg" alt="Ciphermaniac Logo" width="120" height="120">
  </p>
</a>

<h1 align="center">Ciphermaniac</h1>

<p align="center">
  <strong>Pokémon TCG tournament data, visualized</strong>
</p>

<p align="center">
  <a href="https://ciphermaniac.com">Live Site</a> •
  <a href="#what-it-does">What It Does</a> •
  <a href="#how-the-data-flows">How the Data Flows</a> •
  <a href="#development">Development</a> •
  <a href="#credits">Credits</a>
</p>

<p align="center">
  <a href="https://ciphermaniac.com"><img src="https://img.shields.io/badge/website-ciphermaniac.com-fee475?style=flat-square" alt="Website"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen?style=flat-square" alt="Node Version">
  <img src="https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square" alt="TypeScript Strict">
</p>

---

Ciphermaniac answers the questions competitive Pokémon TCG players actually ask: who plays this card, how many copies, and is it trending up or down? Pick any card and see which decks run it. Browse archetypes, compare variants, and filter decklists by the exact cards they include or exclude.

## What It Does

- **Card pages** — usage across archetypes, average copy counts, a price history sparkline, and usage over time
- **Archetype breakdowns** — core lists, tech choices, and side-by-side variant comparisons
- **Meta trends** — archetype popularity shifts, rising and falling cards, and price movers
- **Player profiles** — tournament results per player, with head-to-head comparison across shared events
- **Flexible filtering** — stack multiple includes and excludes, down to specific copy counts
- **Fast loads** — reports are precomputed and served as static artifacts, so pages render in under a second

## How the Data Flows

GitHub Actions collect and process everything on a schedule; the site itself never scrapes anything at request time.

| Pipeline | What it does | When |
|----------|--------------|------|
| Online Meta Report | Aggregates the last 14 days of online tournaments from [PlayLimitless](https://play.limitlesstcg.com/) | Daily |
| Daily Price Check | Pulls TCGPlayer market prices via [TCGCSV](https://tcgcsv.com/) and appends rolling price history | Daily |
| Trends Report | Computes archetype popularity, card usage shifts, and price movers | Daily |
| Player Aggregator | Builds per-player results and head-to-head data | Daily |
| Card Metadata | Refreshes card synonyms, types, and WebP thumbnails | Daily / weekly |
| Download Tournament | Scrapes Day 2 decklists from major events on [LimitlessTCG](https://limitlesstcg.com/) | On demand |

Artifacts land in Cloudflare R2 (browsable at [r2.ciphermaniac.com](https://r2.ciphermaniac.com/)), and the site runs on Cloudflare Pages with Functions backed by KV, R2, and D1.

**Stack:** SolidJS + TypeScript (strict) + Vite on the front end; Cloudflare Pages Functions on the back.

## Development

```bash
git clone https://github.com/rosematcha/ciphermaniac.git
cd ciphermaniac
npm install
npm run dev
```

Requires Node 20+.

| Command | What it runs |
|---------|--------------|
| `npm run dev` | Vite dev server |
| `npm run build` | Production build |
| `npm run validate` | Typecheck (frontend, backend, node) + ESLint |
| `npm test` | Unit tests |
| `npm run test:mobile` | Playwright mobile tests |
| `npm run knip` | Dead code check |

CI runs the same quality gates plus a Lighthouse performance budget on every push.

## Credits

- **[LimitlessTCG](https://limitlesstcg.com)**, **[PlayLimitless](https://play.limitlesstcg.com)**, and **[Robin](https://x.com/limitless_robin)** — tournament data. The Limitless team's work is foundational to the Pokémon TCG community.
- **[TrainerHill](https://trainerhill.com)** and **Brad** — deck archetype analysis and early development support.
- **[TCGCSV](https://tcgcsv.com)** and **CptSpaceToaster** — TCGPlayer market prices in a usable form after TCGPlayer's API crackdown.

## License

MIT — see [LICENSE](LICENSE).

---

<p align="center">
  <sub>Not affiliated with The Pokémon Company, Nintendo, Game Freak, Creatures Inc., or RK9.</sub>
</p>
