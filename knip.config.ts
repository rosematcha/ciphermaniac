import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  entry: [
    // SPA entry point (src/main.tsx) is picked up by knip's Vite plugin.

    // Cloudflare Pages Functions (file-based routing; everything outside lib/ is a route)
    'functions/**/*.{ts,js}',
    '!functions/lib/**',

    // Node scripts
    'scripts/*.{ts,mjs}',
    '.github/scripts/*.{ts,mjs}',

    // Tests (so their imports count as "used")
    'tests/**/*.{test,spec}.{ts,js,mjs}'
  ],

  project: [
    'src/**/*.{ts,tsx}',
    'shared/**/*.ts',
    'functions/**/*.{ts,js}',
    'scripts/**/*.{ts,mjs}',
    '.github/scripts/*.{ts,mjs}',
    'tests/**/*.{ts,js,mjs}'
  ],

  ignore: [
    // Contract layer lands ahead of its producers (DB-MASTER-PLAN Phase 2 adopts
    // it); its exports have no consumers yet. Remove this ignore then.
    'shared/data/**',
    // Generated embedded-release module; its consumer (the src/lib/data.ts
    // release-aware resolver) arrives with the measured Phase 4 frontend rollout.
    'src/generated/**'
  ]
};

export default config;
