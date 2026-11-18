import { defineConfig } from '@playwright/test';

// End-to-end tests run against the production build (so the strict CSP and service worker are
// exercised) using the offline demo provider: no key and no network inference are needed.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    // Uses the locally installed Chrome by default; set PW_CHANNEL= (empty) to use Playwright's own Chromium.
    channel: (process.env.PW_CHANNEL ?? 'chrome') || undefined,
    viewport: { width: 412, height: 915 },
    locale: 'en-GB',
  },
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
