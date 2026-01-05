<p align="center">
  <img src="public/assets/images/logo.svg" alt="Ciphermaniac Logo" width="120" height="120">
</p>

<h1 align="center">Ciphermaniac</h1>

<p align="center">
  <strong>Pokémon TCG tournament data visualization and meta analysis</strong>
</p>

<p align="center">
  <a href="https://ciphermaniac.com">Live Site</a> •
  <a href="#features">Features</a> •
  <a href="#how-it-works">How It Works</a> •
  <a href="#development">Development</a> •
  <a href="#credits">Credits</a>
</p>

<p align="center">
  <a href="https://ciphermaniac.com"><img src="https://img.shields.io/badge/website-ciphermaniac.com-fee475?style=flat-square" alt="Website"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen?style=flat-square" alt="Node Version">
  <img src="https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square" alt="TypeScript Strict">
  <img src="https://img.shields.io/badge/ESLint-enabled-4B32C3?style=flat-square" alt="ESLint">
</p>

---

Ciphermaniac aggregates Pokémon TCG tournament data and turns it into something useful. Look up any card and see where it's played. Browse archetypes and filter by specific cards. Track what's rising and falling in the meta.

**[ciphermaniac.com](https://ciphermaniac.com)**

---

## Features

- **Per-card data** — Pick any card, see which decks run it, average copy count, and usage over time
- **Archetype breakdowns** — Core lists, tech choices, and variant comparisons
- **Flexible filtering** — Multiple includes, multiple excludes, specific copy counts
- **Meta trends** — Track archetype popularity and card usage shifts over time
- **Price data** — Current market prices from TCGPlayer
- **Fast loads** — Reports are statically compiled, so pages load in under a second

---

## How It Works

Tournament data is collected and processed automatically through GitHub Actions:

| Pipeline | Description | Schedule |
|----------|-------------|----------|
| **Online Meta** | Aggregates the last 14 days of online tournaments from [PlayLimitless](https://play.limitlesstcg.com/) | Daily |
| **Daily Pricing** | Fetches market prices from [TCGCSV](https://tcgcsv.com/) | Daily |
| **Tournament Reports** | Scrapes Day 2 decklists from major events on [LimitlessTCG](https://limitlesstcg.com/) | On-demand |
| **Meta Trends** | Computes archetype popularity and card usage trends | Daily |

Data is stored in Cloudflare R2 and served via Cloudflare Pages.

---

## Development

<details>
<summary><strong>Getting Started</strong></summary>

### Prerequisites
- Node.js >= 20.0.0
- npm

### Installation

```bash
git clone https://github.com/rosematcha/ciphermaniac.git
cd ciphermaniac
npm install
```

### Development Server

```bash
npm run dev
```

</details>

<details>
<summary><strong>Available Commands</strong></summary>

```bash
npm run lint          # Check code quality with ESLint
npm run lint:fix      # Fix linting issues
npm run typecheck     # Run TypeScript type checking
npm run validate      # Run all validation checks (lint + typecheck)
npm run dev           # Start development server
npm run build:prod    # Build production bundle (strips debug code)
npm run test          # Run all tests
```

</details>

<details>
<summary><strong>Production Build</strong></summary>

The production build strips development code before deployment:

```bash
npm run prepare:prod  # Creates optimized build & updates HTML files
```

**What gets stripped:**
- `perf.start()` and `perf.end()` calls
- `logger.debug()` statements
- Dead code via tree-shaking

Production builds run automatically during Cloudflare Pages deployment.

To restore development configuration:

```bash
npm run restore:dev
```

</details>

<details>
<summary><strong>Performance Monitoring</strong></summary>

Performance monitoring is enabled on localhost and stripped from production builds.

```typescript
import { measureFunction } from './utils/performance.js';

const measuredSort = measureFunction(sortData, 'sortData');
measuredSort(data); // Logs: "Performance: sortData took 15.42ms"
```

```typescript
import { perf } from './utils/performance.js';

perf.start('myOperation');
// ... do work ...
perf.end('myOperation');
```

</details>

<details>
<summary><strong>GitHub Actions</strong></summary>

- **Online Meta Report** (`online-meta.yml`) — Aggregates online tournaments. Daily.
- **Daily Price Check** (`daily-pricing.yml`) — Fetches market prices. Daily.
- **Download Tournament** (`download-tournament.yml`) — Scrapes major tournament decklists. On-demand.
- **Meta Trends** (`trends.yml`) — Computes archetype and card trends. Daily.

</details>

---

## Credits

- **[LimitlessTCG](https://limitlesstcg.com)**, **[PlayLimitless](https://play.limitlesstcg.com)**, and **[Robin](https://x.com/limitless_robin)** — Tournament data. The Limitless team's work is foundational to the Pokémon TCG community.

- **[TrainerHill](https://trainerhill.com)** and **Brad** — Deck archetype analysis and early development support.

- **[TCGCSV](https://tcgcsv.com)** and **CptSpaceToaster** — TCGPlayer market prices.

---

## License

MIT — see [LICENSE](LICENSE) for details.

---

<p align="center">
  <sub>Not affiliated with The Pokémon Company, Nintendo, Game Freak, Creatures Inc., or RK9.</sub>
</p>
