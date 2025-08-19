# Ciphermaniac – Card Usage Report Viewer

## Overview
Ciphermaniac is a lightweight, zero-dependency web app for viewing, searching, and analyzing card usage from competitive tournament reports. It is designed for speed, modularity, and a modern, responsive user experience on desktop and mobile. The app is built with vanilla JS/HTML/CSS and loads static JSON data for instant access.

## Core Features

### Data Ingestion & Parsing
- Loads tournament reports from static JSON files (`reports/<Tournament>/master.json` and archetypes).
- Parses decklists, aggregates card usage, and normalizes archetype names.
- Supports per-card and per-archetype usage breakdowns.
- Caches parsed data in localStorage for fast reloads and offline resilience.

### Filtering, Sorting, and Search
- Search bar for instant card name filtering.
- Sort dropdown: most used, least used, alphabetical (A→Z, Z→A).
- Archetype filter: select decks by archetype, with deck counts per archetype.
- Tournament selector: switch between events, with dynamic data reload.
- Deep link support: search, sort, archetype, and tournament state are encoded in the URL for shareable views.

### Card Grid & Responsive Layout
- Renders cards in a compact, centered grid with per-row scaling.
- First two rows are "big" (scale=1, sm thumbnails); subsequent rows are smaller (xs thumbnails).
- Card base width and gap are responsive, ensuring >=2 cards per row on mobile.
- Controls bar width matches big row width and centers; CSS overrides to 100% on mobile.
- Empty state: "Dead draw." message when no cards match filters.

### Thumbnails & Image Handling
- Thumbnail selection: big rows use `thumbnails/sm/`, small rows use `thumbnails/xs/`.
- Per-card filename overrides via `assets/overrides.json` for robust fallback.
- Lazy-load images with fade-in animation; missing images are tracked for dev reporting.
- Dev tool: logs missing thumbnail candidates and proposes override mappings.

### Per-Card Details Page
- Dedicated card page (`card.html`) shows meta-share and copy counts over time.
- SVG chart visualizes card usage trends across tournaments.
- Table of common archetypes using the card.
- Planned: time window selector, hover tooltips, loading/error states, deck-level analysis.

### UI & Accessibility
- Modern, dark theme with high contrast and readable fonts.
- Semantic HTML5 structure; ARIA roles for grid and controls.
- Keyboard navigation for grid and per-card links.
- Mobile-friendly controls: filters toggle, stacked controls bar.
- Header and footer are consistent across all pages, with logo, navigation, credits, and author link.

### Dev & Maintenance
- Modular JS: clear separation of parsing, controls, rendering, layout, API, and dev tools.
- No external dependencies; fast initial load and minimal bundle size.
- Easy to add new tournaments or archetypes by dropping JSON files.
- Unit tests for parsing and sorting (see `tests.html`).
- All layout constants are centralized for easy tuning.

## Current Roadmap

### Short-Term
- [x] Unit tests for parsing and sorting.
- [x] Dev tool for missing thumbnails and override proposals.
- [x] Extract per-row sizing constants to config module.
- [x] Move header width sync to layout helper.
- [x] Local caching v1 for parsed data.
- [x] Thumbnail UX: lazy-load, fade-in, zero dependencies.
- [x] Per-card pages: meta-share chart, archetype table.
- [x] Deep link support for filters and tournament state.
- [x] Header/footer/navigation refactor for consistent layout.
- [x] Responsive toolbar for search/filters.
- [x] Accessibility improvements (labels, focus order, ARIA roles).
- [ ] Client-side router: finish support for `#card/<name>` and grid routes; handle bad routes gracefully.
- [ ] Time window selector and tooltips for per-card charts.
- [ ] Extend tests to cover router parsing and combined search+filters.

### Medium-Term
- [ ] Per-card time series: precompute and cache aggregates for fast load.
- [ ] In-depth card analysis: deck-level usage rates per event.
- [ ] Tournament timeline view: meta-share trends over time.
- [ ] Top-X filters (e.g., Top 64, Top 8): parsing and UI support.
- [ ] Improved mobile grid density and thumbnail clarity.
- [ ] Accessibility polish: keyboard nav for all controls, ARIA-expanded for toggles.
- [ ] Export/share: deep links for filtered views and per-card pages.
- [ ] Service worker for offline caching (opt-in).

### Long-Term
- [ ] Static build script for precomputed aggregates and CI publishing.
- [ ] Optional analytics for card opens (privacy-first).
- [ ] More advanced charting and deck-level breakdowns.
- [ ] Community features: user tagging, deck sharing, comments.

## Author & Credits
- Created by [@dustoxgdp63](https://x.com/dustoxgDP63)
- Data sourced from [LimitlessTCG](https://limitlesstcg.com/tournaments/500)
- UI inspired by [TrainerHill](https://www.trainerhill.com/)

---

This document summarizes Ciphermaniac's current features and roadmap. Please review and propose roadmap revisions or new features for future releases.
