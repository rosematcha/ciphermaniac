import { defineConfig, devices } from '@playwright/test';

/**
 * Deterministic browser tests (DB-MASTER-PLAN quality initiative, Phase 10).
 *
 * These run against a fixture dataset served from `tests/fixtures/e2e/`, not
 * against production R2, so a failure means the code changed rather than the
 * meta did. That makes them safe to gate pull requests on.
 *
 * The origin is baked into the bundle by VITE_DATA_ORIGIN, so the fixture
 * server's port is fixed rather than ephemeral.
 */

// Overridable so two checkouts can run the suite side by side.
const FIXTURE_PORT = Number(process.env.E2E_FIXTURE_PORT ?? 4320);
const PREVIEW_PORT = Number(process.env.E2E_PREVIEW_PORT ?? 4321);
const FIXTURE_ORIGIN = `http://127.0.0.1:${FIXTURE_PORT}`;

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  retries: 0,
  workers: 4,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    serviceWorkers: 'block',
    baseURL: `http://127.0.0.1:${PREVIEW_PORT}`,
    // Any request that escapes to the real R2 is a bug in the fixture setup,
    // not a passing test with a slow network.
    trace: 'retain-on-failure'
  },
  projects: [
    { name: 'desktop', grepInvert: /@mobileOnly/, use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', grep: /@mobile/, use: { ...devices['Pixel 7'] } }
  ],
  webServer: [
    {
      command: `npx tsx tests/e2e/serve-fixtures.ts`,
      url: `${FIXTURE_ORIGIN}/reports/tournaments.json`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { FIXTURE_PORT: String(FIXTURE_PORT) }
    },
    {
      command: `npx vite build --config tests/e2e/release-build.config.ts --outDir .cache/e2e-dist && npx vite preview --outDir .cache/e2e-dist --host 127.0.0.1 --port ${PREVIEW_PORT} --strictPort`,
      url: `http://127.0.0.1:${PREVIEW_PORT}/`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { VITE_DATA_ORIGIN: FIXTURE_ORIGIN }
    }
  ]
});
