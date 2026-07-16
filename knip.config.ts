import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  // Exports referenced only inside their own module (internal constants that
  // are exported for documentation/typing) are not dead code.
  ignoreExportsUsedInFile: true,

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
  ]
};

export default config;
