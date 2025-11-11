
# Ciphermaniac

## Development Commands

```bash
npm run lint          # Check code quality
npm run lint:fix      # Fix linting issues
npm run typecheck     # Run TypeScript type checking
npm run validate      # Run all validation checks
npm run dev           # Start development server
```



## GitHub Actions
This repo uses a few GitHub Actions to automate its functionality.

### Online Meta Report (`online-meta.yml`)
Using data from [PlayLimitless](https://play.limitlesstcg.com/), we aggregate the last 14 days of online tournaments into a single meta report. Runs once a day at noon UTC.
* Fetches recent online tournaments from the Limitless API and filters for PTCG Standard format events.
* Downloads decklists from top placements, scaled by tournament size (larger tournaments = more decks analyzed).
* Aggregates card usage statistics and generates archetype breakdowns.
* Generates include/exclude filtered reports for archetype variants (e.g., "Gardevoir with Munkidori", "Gardevoir without Munkidori").
* Uploads all reports (master, meta, decks, archetypes, and filtered variants) to our Cloudflare R2 storage bucket.

### Daily Price Check (`daily-pricing.yml`)
Using data from [TCGCSV](https://tcgcsv.com/), we create a condensed JSON with only the prices we need. Runs once a day at noon UTC.
* Reviews the most recent online report and our synonyms, creating a list of card UIDS (ie. TEF 097) which need their price checked.
* Downloads the CSVs of prices for every set with cards on the site from TCGCSV, using their static map of set IDs.
* Scans the CSVs for market prices for each card (ie. TEF 097 has a market value of $0.07), and hardcodes a one-cent price for Basic Energy.
* Uploads the resulting report to our Cloudflare R2 storage bucket.

### Download Tournament Report (`download-tournament.yml`)
This will add all Day 2 entries from a major tournament to the database. Runs only on user command.
* Input is accepted in the form of a LimitlessTCG link (ie. `https://limitlesstcg.com/tournaments/500`), and all decklists are scraped in a Pokémon TCG Live-compliant format.
* Synonyms are generated for each card, ie. Psychic Energy SVE 013 and Psychic Energy SVE 021, to keep data consistent.
* From the scraped and normalized data, all expected reports (master, meta, decks, cardIndex, synonyms, and archetypes) are generated.
* All outputs are uploaded to our Cloudflare R2 storage bucket.

### Deploy Pages (`deploy-pages.yml`)
Deploys the Ciphermaniac website to Cloudflare Pages. Runs automatically on every push to the main branch.
* Checks out the repository and sets up Node.js.
* Installs dependencies and builds Cloudflare Pages Functions.
* Deploys the `public/` directory to Cloudflare Pages.
* Updates any cron triggers defined in the wrangler configuration.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Credits

* [LimitlessTCG](https://limitlesstcg.com), [PlayLimitless](https://play.limitlesstcg.com), and [Robin](https://x.com/limitless_robin) for providing incredibly in-depth and easy to access data. The work the Limitless team does is foundational to the modern Pokémon community, and our game wouldn't be the same without their incredible work.
* [TrainerHill](https://trainerhill.com) and Brad for high-fidelity, granular, and modular deck archetype analysis enabling creative deck building, as well as support in the early stages of development.
* [TCGCSV](https://tcgcsv.com) and CptSpaceToaster for exposing TCGPlayer market price in a compatible and malleable form after TCGPlayer's API crackdown.

As a reminder, we are not and do not claim to be affiliated with The Pokémon Company, Nintendo, Game Freak, Creatures Inc., RK9, or any of their subsidiaries.