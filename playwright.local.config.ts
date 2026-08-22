import { defineConfig, devices } from '@playwright/test';

/**
 * Deterministic browser tests (DB-MASTER-PLAN quality initiative, Phase 10).
 *
 * These run against a fixture dataset served from `tests/fixtures/e2e/`, not
 * against production R2, so a failure means the code changed rather than the
 * meta did. That is what makes them safe to gate pull requests on — the live
 * suite in `playwright.config.ts` stays as an integration canary, where a
 * failure is genuinely ambiguous between "we broke it" and "R2 is having a day".
 *
 * The origin is baked into the bundle by VITE_DATA_ORIGIN, so the fixture
 * server's port is fixed rather than ephemeral.
 */

const FIXTURE_PORT = 4320;
const PREVIEW_PORT = 4321;
const FIXTURE_ORIGIN = `http://127.0.0.1:${FIXTURE_PORT}`;

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PREVIEW_PORT}`,
    // Any request that escapes to the real R2 is a bug in the fixture setup,
    // not a passing test with a slow network.
    trace: 'retain-on-failure'
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } }
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
      command: `npm run build && npx vite preview --host 127.0.0.1 --port ${PREVIEW_PORT} --strictPort`,
      url: `http://127.0.0.1:${PREVIEW_PORT}/`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { VITE_DATA_ORIGIN: FIXTURE_ORIGIN }
    }
  ]
});
