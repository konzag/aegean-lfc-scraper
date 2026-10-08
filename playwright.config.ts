import { defineConfig, devices } from '@playwright/test';

/**
 * The scraper specs hit el.aegeanair.com behind Akamai. Running them in
 * parallel or across several browsers multiplies the request rate and gets
 * the session blocked, so: one Chromium project, one worker, no parallelism.
 * Run a single spec via the npm scripts (see package.json / README).
 *
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  // Never auto-retry a multi-hour scrape.
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
