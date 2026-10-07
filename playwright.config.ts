import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright config.
 *
 * `webServer` starts the dev server automatically, so `pnpm e2e` is one command
 * with no separate terminal. CI reuses an already-built server via
 * `PLAYWRIGHT_BASE_URL` when present.
 *
 * The specs run in Chromium only for now. The shell is deliberately plain DOM —
 * no canvas assertions except the map placeholder — so one browser is honest
 * coverage. Safari and Firefox matter once MapLibre and print CSS are exercised
 * (Phases 1 and 5).
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 30_000,
  expect: { timeout: 7_000 },

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'pnpm dev',
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
})