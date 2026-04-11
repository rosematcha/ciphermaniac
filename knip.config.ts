import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  entry: [
    // Frontend page loaders (loaded via <script> tags in HTML)
    'src/loaders/*.ts',

    // Components loaded from HTML inline scripts (not traced by knip)
    'src/components/header.ts',
    'src/components/footer.ts',

    // Page modules loaded from HTML inline scripts
    'src/incidents.ts',
    'src/ui.ts',

    // Cloudflare Pages Functions (file-based routing)
    'functions/\\[\\[path\\]\\].js',
    'functions/archetype/\\[\\[path\\]\\].js',
    'functions/card/\\[\\[path\\]\\].js',
    'functions/players/\\[\\[path\\]\\].js',
    'functions/thumbnails/\\[\\[path\\]\\].ts',
    'functions/sitemap.xml.ts',
    'functions/reports/[tournament]/manifest.json.ts',
    'functions/api/feedback.ts',
    'functions/api/limitless/tournaments.ts',
    'functions/api/archetype/filter-report.ts',
    'functions/_cron/online-meta.ts',

    // Node scripts
    'scripts/*.mjs',
    'tools/*.mjs',

    // Tests (so their imports count as "used")
    'tests/**/*.test.{ts,js,mjs}',
    'tools/*.test.ts'
  ],

  project: ['src/**/*.ts', 'shared/**/*.ts', 'functions/**/*.{ts,js}', 'scripts/**/*.mjs', 'tools/**/*.{ts,mjs}'],

  ignore: [
    // Dev-only file referenced in lint scripts but not imported
    'src/dev/layoutTests.ts',
    // These .ts files are imported via .js extensions; knip can't resolve them
    'shared/cardUtils.ts',
    'shared/reportUtils.ts',
    'shared/synonyms.ts'
  ]
};

export default config;
