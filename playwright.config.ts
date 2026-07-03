import { defineConfig } from '@playwright/test';

/**
 * Mobile viewport regression suite (mobile plan P4.1).
 * Run with `npm run test:mobile`. Needs network access (report data comes
 * from r2.ciphermaniac.com), so it's separate from the unit-test gate.
 */
export default defineConfig({
  testDir: 'tests/mobile',
  timeout: 45_000,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: 'http://localhost:5173'
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000
  }
});
