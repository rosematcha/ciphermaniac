# Workflows

Every piece of Ciphermaniac automation runs here: data collection, artifact
generation, the Cloudflare Pages deploy, and the code quality gates. The site
never scrapes anything at request time.

**The YAML is the source of truth.** This file records purpose, cadence, blast
radius, and how to undo things — the facts an operator needs before pressing
"Run workflow". It deliberately does not restate step lists, which go stale the
moment anyone edits a job.

## The one invariant

Every workflow that writes to R2 shares one concurrency group:

```yaml
concurrency:
  group: r2-bucket-writers
  cancel-in-progress: false
```

So no two data workflows ever touch the bucket at the same time, and a queued
run waits rather than being cancelled. If a job looks stuck "pending", something
else is mid-write. Only `quality-gates` and `lighthouse` are outside the group;
they touch no data.

## Daily schedule (UTC)

| Time | Workflow | Then triggers |
|---|---|---|
| 03:00 | Card Metadata: Types | — |
| 05:00 | Card Metadata: Archetype Icons | — |
| 06:00 | Card Metadata: Synonyms | Reprocess Event Indexes |
| 12:00 | Online Meta Report | Trends, Player Aggregator |
| 13:00 | Player Aggregator | — |
| 14:00 | Daily Price Check | — |
| 15:00 | Publish Data Release | — |
| Mon 04:30 | Card Images: WebP Conversion | — |

The ordering is load-bearing. Pricing runs at 14:00 because it reads what
online-meta wrote at 12:00; the release publishes at 15:00 so it captures the
whole day's output. Downstream `workflow_run` chains fire only when the upstream
run succeeded.

## Data workflows

| Workflow | Trigger | Writes | Destructive |
|---|---|---|---|
| `online-meta.yml` | 12:00 daily, manual | `reports/Online - Last 14 Days/**` | Only with `clean_month_cache` |
| `trends.yml` | after online-meta, manual | `reports/Trends - Last 30 Days/**`, majors trends | Only with `clean_month_cache` |
| `player-aggregator.yml` | 13:00 daily, after online-meta / download-tournament / refresh-index, manual | `players/**` | No (rewrites in place) |
| `daily-pricing.yml` | 14:00 daily, manual | `reports/prices.json` + history | No |
| `publish-data-release.yml` | 15:00 daily, manual | `releases/v1/**`, channel pointer, **and deploys Pages** | No (immutable + pointer) |
| `download-tournament.yml` | manual only | `reports/{date, name}/**`, `reports/tournaments.json` | No |
| `reprocess-event-indexes.yml` | after Synonyms, manual | Rebakes every event's indexes | **Yes** — see below |
| `reconcile-data.yml` | manual only | Every event's `cardUsage`/`conversion`, `tournaments.json` | Only with `apply: true` |
| `refresh-tournaments-index.yml` | manual only | `reports/tournaments.json` | Dry run by default |
| `reset-labs-history.yml` | manual only | Re-scrapes Labs events, then full player rebuild | **Yes** |
| `backfill-price-history.yml` | manual only | `reports/prices-history.json` + shards | Rewrites the window |
| `backfill-print-prices.yml` | manual only | `assets/print-prices/{date}.json` | No (skips existing unless `force`) |

## Card metadata workflows

These three also **commit to `main`** with `[skip ci]`, using `contents: write`:

| Workflow | Trigger | Commits | Also writes |
|---|---|---|---|
| `update-card-synonyms.yml` | 06:00 daily, manual | `public/assets/card-synonyms.json` | `assets/card-synonyms.json` in R2 |
| `update-card-types.yml` | 03:00 daily, manual | `public/assets/data/card-types.json` | `assets/data/card-types.json`, `evolves-from.json` |
| `update-archetype-icons.yml` | 05:00 daily, manual | `src/data/archetype-icons.json` | Sprite mirror in R2 |
| `convert-card-images.yml` | Mon 04:30, manual | — | `card-images/**` + `_ready` marker |

`update-card-synonyms` fails outright if the generated database's card-route
graph is unsound (a redirect cycle, a multi-hop redirect, or two clusters
contesting one `(set, number)`). Shipping a looping database is worse than
shipping a stale one.

## Code workflows

| Workflow | Trigger | What it does |
|---|---|---|
| `quality-gates.yml` | PR, push to main | `npm audit`, then `npm run verify` — nothing else |
| `lighthouse.yml` | PR, push to main | Mobile performance budget from `.lighthouserc.json` |

`quality-gates` runs exactly the command a developer runs locally. Adding a
check means editing `package.json`'s `verify` script, not this workflow — if CI
keeps its own list, `npm run verify` quietly stops meaning "CI will pass".

## Deployment

There is no `deploy-pages.yml`. The Cloudflare Pages deploy lives inside
`publish-data-release.yml`, between building the release and moving the channel
pointer, because the frontend embeds the release manifest at build time:

1. `build-loop.ts` builds dirty nodes and emits the release roots
2. `publish-release.ts` writes immutable artifacts and generates `src/generated/release.ts`
3. `npm run build` bakes that manifest into the bundle
4. `wrangler pages deploy dist`
5. `update-channel.ts` moves the channel pointer to the new release

A push to `main` does **not** deploy. Manual dispatch defaults to the `shadow`
channel; the schedule publishes to `production`.

## Rollback

- **Bad data release** — re-run `publish-data-release.yml`, or point the channel
  at a prior release with `update-channel.ts`. Release artifacts are immutable
  and content-addressed, so a rollback moves one pointer and touches no bodies.
- **Bad event data** — re-run `download-tournament.yml` for that event, then
  `reprocess-event-indexes.yml` to rebake its derived indexes.
- **Bad synonym database** — revert the `[skip ci]` commit on `main` and re-run
  `update-card-synonyms.yml` with `full_rewrite: true`.
- **Bad prices** — `backfill-price-history.yml` rebuilds the window from the
  TCGCSV archives.
- **Bad deploy** — roll back the deployment in the Cloudflare Pages dashboard;
  the data channel pointer is independent of it.

## Manual runs and their defaults

Most dispatchable workflows default to the safe side, but not uniformly. Check
before you press the button:

| Workflow | Key input | Default |
|---|---|---|
| `reprocess-event-indexes.yml` | `dry_run` | **true** on dispatch |
| `refresh-tournaments-index.yml` | `dry_run_refresh` | **true** |
| `reconcile-data.yml` | `apply` | **false** (dry run) |
| `publish-data-release.yml` | `channel` | **shadow** on dispatch, production on schedule |
| `reset-labs-history.yml` | `dry_run` | **false** — this one bites |
| `online-meta.yml` | `clean_month_cache` | false; true deletes 30 days of artifacts |

**Known sharp edge:** `reprocess-event-indexes.yml` also fires automatically
after `update-card-synonyms.yml`. On that path the dispatch inputs are empty, so
`dry_run` is not set and it rebakes every event for real. That is the intended
behavior — a synonym change must propagate — but it means a bad synonym database
reaches every event's indexes within the hour. The route-soundness gate in the
synonym generator exists to catch the worst version of that.

## Secrets

| Secret | Used by |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | every R2 writer |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | every R2 writer |
| `R2_BUCKET_NAME` | most R2 writers; several hardcode `ciphermaniac-reports` |
| `LIMITLESS_API_KEY` | `online-meta.yml`, `trends.yml` |
| `CLOUDFLARE_API_TOKEN` | `publish-data-release.yml` (Pages deploy only) |

## Runtimes

Node 22 and Python 3.11, pinned in every workflow. `scripts/check-repo-metadata.ts`
fails CI if any workflow's `node-version` drifts from `package.json`'s
`engines.node`, or references a script path that does not exist.

Python producers install from `.github/scripts/requirements.txt` — never ad hoc,
so a pipeline run is reproducible.

## Adding or changing a workflow

- Put every R2 writer in the `r2-bucket-writers` concurrency group.
- Declare `permissions:` explicitly; `check-repo-metadata` fails if you don't.
- Give destructive operations a dry-run input, and default it to the dry run.
- Set `timeout-minutes` — an R2 writer that hangs blocks every other writer.
- Note the rollback path here if it isn't one of the ones above.
